/**
 * Phoenix V1 spot client — place/cancel via @ellipsis-labs/phoenix-sdk.
 * No Meridian CPI for plain Yes trades (ARCHITECTURE).
 */
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { buildMintIx, type MintAccounts } from "@/lib/solana/instructions";
import type { MeridianProgram } from "@/lib/solana/program";
import {
  PHOENIX_NOT_CONFIGURED_MESSAGE,
  SELL_NO_MERGE_CAVEAT,
  hasPhoenixMarketPubkey,
  isPhoenixPlacementEnabled,
} from "./config";
import {
  effectiveYesLimitPrice,
  planIntentComposition,
} from "./compose";
import { buildClaimSeatInstructions } from "./seat";
import type {
  ComposePlanSummary,
  PhoenixPlaceOrderRequest,
  PhoenixPlaceOrderResult,
} from "./types";

export interface PlaceContext {
  connection: Connection;
  publicKey: PublicKey;
  /** Wallet adapter sendTransaction */
  sendTransaction: (
    tx: Transaction,
    connection: Connection,
    opts?: { skipPreflight?: boolean },
  ) => Promise<string>;
  /** Required for Buy No mint leg */
  program?: MeridianProgram;
  mintAccounts?: MintAccounts;
  /** Include seat/ATA setup ixs when missing (default true) */
  ensureSeat?: boolean;
  /**
   * USDC decimals for mint amount (default 6).
   * Mint amount = size * 10^decimals (1 USDC per contract pair).
   */
  collateralDecimals?: number;
}

function notConfigured(
  mapped: { side: "bid" | "ask"; yesPrice: number; size: number },
  plan: ComposePlanSummary,
  message = PHOENIX_NOT_CONFIGURED_MESSAGE,
): PhoenixPlaceOrderResult {
  return {
    ok: false,
    stub: false,
    reason: "not-configured",
    message,
    mapped,
    plan,
  };
}

async function buildPhoenixPlaceIx(
  connection: Connection,
  market: PublicKey,
  trader: PublicKey,
  plan: ComposePlanSummary,
  limitYesPrice: number,
): Promise<{ ix: TransactionInstruction; setup: TransactionInstruction[] }> {
  const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
  const client = await PhoenixSdk.Client.createWithMarketAddresses(connection, [
    market,
  ]);
  const key = market.toBase58();
  if (!client.marketStates.get(key)) {
    await client.addMarket(key, true);
  }

  const side =
    plan.phoenixSide === "bid" ? PhoenixSdk.Side.Bid : PhoenixSdk.Side.Ask;
  const selfTrade = PhoenixSdk.SelfTradeBehavior.Abort;

  let ix: TransactionInstruction;
  if (plan.orderType === "post-only") {
    ix = client.getPostOnlyOrderInstructionfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits: plan.size,
      clientOrderId: Date.now() % 1_000_000,
      rejectPostOnly: true,
      useOnlyDepositedFunds: false,
    });
  } else if (plan.orderType === "market") {
    ix = client.getImmediateOrCancelOrderIxfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits: plan.size,
      sizeInQuoteUnits: 0,
      minBaseUnitsToFill: 0,
      minQuoteUnitsToFill: 0,
      selfTradeBehavior: selfTrade,
      clientOrderId: Date.now() % 1_000_000,
      useOnlyDepositedFunds: false,
    });
  } else {
    ix = client.getLimitOrderInstructionfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits: plan.size,
      selfTradeBehavior: selfTrade,
      clientOrderId: Date.now() % 1_000_000,
      useOnlyDepositedFunds: false,
    });
  }

  const setup =
    (await buildClaimSeatInstructions(connection, market, trader)).instructions ??
    [];
  return { ix, setup };
}

/**
 * Place (or plan) a Phoenix order for a Meridian trading intent.
 * Without PlaceContext / when not configured → structured failure (never fake ok).
 */
export async function placePhoenixOrder(
  req: PhoenixPlaceOrderRequest,
  ctx?: PlaceContext,
): Promise<PhoenixPlaceOrderResult> {
  const plan = planIntentComposition({
    intent: req.intent,
    price: req.price,
    size: req.size,
    orderType: req.orderType,
    tickSize: req.tickSize,
    worstPrice: req.worstPrice,
  });
  const mapped = {
    side: plan.phoenixSide,
    yesPrice: plan.yesPrice,
    size: plan.size,
  };

  if (!isPhoenixPlacementEnabled(req.phoenixMarket)) {
    return notConfigured(mapped, plan);
  }

  if (!ctx?.publicKey || !ctx.sendTransaction || !ctx.connection) {
    return {
      ok: false,
      reason: "wallet-required",
      message:
        "Wallet required to submit a Phoenix order. Connect a wallet, then confirm.",
      mapped,
      plan,
    };
  }

  const limitYes = effectiveYesLimitPrice(
    plan,
    req.worstPrice,
    req.tickSize ?? 0.01,
  );

  try {
    const market = new PublicKey(req.phoenixMarket);
    const { ix: placeIx, setup } = await buildPhoenixPlaceIx(
      ctx.connection,
      market,
      ctx.publicKey,
      plan,
      limitYes,
    );

    const ixs: TransactionInstruction[] = [];
    if (ctx.ensureSeat !== false && setup.length > 0) {
      ixs.push(...setup);
    }

    if (plan.needsMint) {
      if (!ctx.program || !ctx.mintAccounts) {
        return {
          ok: false,
          reason: "mint-accounts-missing",
          message:
            "Buy No requires Meridian mint accounts (strikeMarket, vault, yes/no mints, treasury, collateral). Wire market mints from indexer/RPC.",
          mapped,
          plan,
        };
      }
      const decimals = ctx.collateralDecimals ?? 6;
      const amount = new BN(Math.round(plan.size * 10 ** decimals));
      const mintBuilder = await buildMintIx(ctx.program, ctx.mintAccounts, amount);
      const mintIx = await mintBuilder.instruction();
      ixs.push(mintIx);
    }

    ixs.push(placeIx);

    // Sell No: bid leg only — merge is Schema TODO
    if (plan.mergeBlocked) {
      // Still submit the bid; surface caveat clearly
    }

    const tx = new Transaction().add(...ixs);
    tx.feePayer = ctx.publicKey;
    const { blockhash } = await ctx.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    const signature = await ctx.sendTransaction(tx, ctx.connection, {
      skipPreflight: false,
    });

    let message = `Submitted ${plan.packaging} (${plan.phoenixSide} Yes @ ${limitYes.toFixed(2)} × ${plan.size}).`;
    if (plan.needsMint) {
      message += " Mint + ask packed in one tx (transient Yes+No OK).";
    }
    if (plan.mergeBlocked) {
      message += ` ${SELL_NO_MERGE_CAVEAT}`;
    }

    return {
      ok: true,
      message,
      mapped: { ...mapped, yesPrice: limitYes },
      plan,
      signature,
      signatures: [signature],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rejected =
      /reject|denied|cancel/i.test(msg) || msg.includes("User rejected");
    return {
      ok: false,
      reason: rejected ? "user-rejected" : "sdk-error",
      message: rejected ? "Wallet rejected the transaction." : `Phoenix place failed: ${msg}`,
      mapped,
      plan,
    };
  }
}

/** Fetch L2 book via Phoenix SDK; null when market unset or load fails. */
export async function fetchPhoenixBook(
  phoenixMarket: string | undefined,
  connection?: Connection,
): Promise<import("@/lib/market/types").OrderBookSnapshot | null> {
  if (!hasPhoenixMarketPubkey(phoenixMarket) || !connection) {
    return null;
  }
  try {
    const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
    const market = new PublicKey(phoenixMarket!);
    const client = await PhoenixSdk.Client.createWithMarketAddresses(
      connection,
      [market],
    );
    const key = market.toBase58();
    if (!client.marketStates.get(key)) {
      await client.addMarket(key, true);
    }
    const ladder = client.getUiLadder(key, 12);
    return {
      bids: (ladder.bids ?? []).map((l: { price: number; quantity: number }) => ({
        price: l.price,
        size: l.quantity,
      })),
      asks: (ladder.asks ?? []).map((l: { price: number; quantity: number }) => ({
        price: l.price,
        size: l.quantity,
      })),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
