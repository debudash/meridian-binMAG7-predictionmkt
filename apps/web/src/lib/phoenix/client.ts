/**
 * Phoenix V1 spot client — place/cancel via @ellipsis-labs/phoenix-sdk.
 * No Meridian CPI for plain Yes trades (ARCHITECTURE).
 * Buy No: mint then place; Sell No immediate: place then merge_pair.
 */
import { BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  buildMergeIx,
  buildMintIx,
  type MintAccounts,
} from "@/lib/solana/instructions";
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
import {
  explainPlaceError,
  isPhoenixMarketPausedError,
  PHOENIX_MARKET_PAUSED_MESSAGE,
  PHOENIX_STATUS_PAUSED,
} from "./errors";
import { buildClaimSeatInstructions } from "./seat";
import { seatSweepIxs, type ManageMarketState } from "./manage";
import {
  contractsToLots,
  DEFAULT_OUTCOME_DECIMALS,
  lotSizeError,
  SizeNotLotAlignedError,
  type LotSizing,
  type PhoenixLotParams,
} from "./size";
import { logChainReadError } from "@/lib/log/chainRead";
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
  /** Required for Buy No mint / Sell No merge legs */
  program?: MeridianProgram;
  mintAccounts?: MintAccounts;
  /** Include seat/ATA setup ixs when missing (default true) */
  ensureSeat?: boolean;
  /**
   * Outcome / collateral decimals (default 6).
   * Used by contractsToLots for mint, merge, and Phoenix sizeInBaseUnits.
   */
  collateralDecimals?: number;
}

/** Idempotent Yes/No/USDC ATAs for Meridian mint / merge_pair legs. */
function meridianAtaIxs(
  payer: PublicKey,
  accounts: MintAccounts,
): TransactionInstruction[] {
  return [accounts.collateralMint, accounts.yesMint, accounts.noMint].map((mint) =>
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      getAssociatedTokenAddressSync(mint, accounts.user),
      accounts.user,
      mint,
    ),
  );
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

/**
 * Load Phoenix market state without the SDK's remote master_config.json
 * (createWithMarketAddresses fetches GitHub config and throws on localnet /
 * any market not listed there). Plain base64 (no zstd) keeps browser deps lean.
 */
export async function loadPhoenixClient(connection: Connection, markets: PublicKey[]) {
  const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
  const client = await PhoenixSdk.Client.createWithoutConfig(connection, markets, false);
  return { PhoenixSdk, client };
}

async function buildPhoenixPlaceIx(
  connection: Connection,
  market: PublicKey,
  trader: PublicKey,
  plan: ComposePlanSummary,
  limitYesPrice: number,
  decimals: number,
): Promise<{
  ix: TransactionInstruction;
  setup: TransactionInstruction[];
  sweep: TransactionInstruction[];
  sized: LotSizing;
}> {
  const { PhoenixSdk, client } = await loadPhoenixClient(connection, [market]);
  const key = market.toBase58();
  // M1: one integer lot count from the loaded market drives the mint, the order and FOK min-fill.
  const meta = client.marketMetadatas.get(key) as PhoenixLotParams | undefined;
  if (!meta) throw new Error(`Phoenix market ${key} not loaded`);
  const sized = contractsToLots(plan.size, meta, decimals);
  const sizeInBaseUnits = sized.phoenixBaseUnits;
  // Free Yes/USDC in this wallet's seat (resting fills) → wallet first, so the order can use it.
  const marketState = client.marketStates.get(key);
  const sweep = marketState
    ? seatSweepIxs(marketState as unknown as Parameters<typeof seatSweepIxs>[0] & ManageMarketState, trader)
    : [];

  const side =
    plan.phoenixSide === "bid" ? PhoenixSdk.Side.Bid : PhoenixSdk.Side.Ask;
  const selfTrade = PhoenixSdk.SelfTradeBehavior.Abort;

  let ix: TransactionInstruction;
  if (plan.orderType === "post-only") {
    ix = client.getPostOnlyOrderInstructionfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits,
      clientOrderId: Date.now() % 1_000_000,
      rejectPostOnly: true,
      useOnlyDepositedFunds: false,
    });
  } else if (plan.orderType === "market") {
    ix = client.getImmediateOrCancelOrderIxfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits,
      sizeInQuoteUnits: 0,
      // Fill-or-kill at the worst price (D-024 / DLV-070): a market order fills its full size
      // or the whole tx reverts — no silent 0-fill "success", no Buy No leaving Yes+No behind.
      minBaseUnitsToFill: sizeInBaseUnits,
      minQuoteUnitsToFill: 0,
      selfTradeBehavior: selfTrade,
      clientOrderId: Date.now() % 1_000_000,
      useOnlyDepositedFunds: false,
    });
  } else {
    ix = client.getLimitOrderInstructionfromTemplate(key, trader, {
      side,
      priceAsFloat: limitYesPrice,
      sizeInBaseUnits,
      selfTradeBehavior: selfTrade,
      clientOrderId: Date.now() % 1_000_000,
      useOnlyDepositedFunds: false,
    });
  }

  const setup =
    (await buildClaimSeatInstructions(connection, market, trader)).instructions ??
    [];
  return { ix, setup, sweep, sized };
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

  // M1 / L12: refuse non-lot-aligned sizes before loading or signing anything.
  const sizeErr = lotSizeError(plan.size, req.lotSize ?? 1);
  if (sizeErr) {
    return { ok: false, reason: "invalid-size", message: sizeErr, mapped, plan };
  }

  const limitYes = effectiveYesLimitPrice(
    plan,
    req.worstPrice,
    req.tickSize ?? 0.01,
  );
  const decimals = ctx.collateralDecimals ?? DEFAULT_OUTCOME_DECIMALS;

  try {
    const market = new PublicKey(req.phoenixMarket);
    const { ix: placeIx, setup, sweep, sized } = await buildPhoenixPlaceIx(
      ctx.connection,
      market,
      ctx.publicKey,
      plan,
      limitYes,
      decimals,
    );

    // Seat claim + mint + swap can exceed the 200k CU default.
    const ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
    ];
    if (ctx.ensureSeat !== false && setup.length > 0) {
      ixs.push(...setup);
    }
    if (
      ctx.mintAccounts &&
      (plan.needsMint || (plan.needsMerge && !plan.mergeBlocked))
    ) {
      ixs.push(...meridianAtaIxs(ctx.publicKey, ctx.mintAccounts));
    }
    // Seat sweep after ATAs exist (setup / meridianAtaIxs create Yes + USDC ATAs) — DLV-087.
    ixs.push(...sweep);

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
      const mintBuilder = await buildMintIx(
        ctx.program,
        ctx.mintAccounts,
        new BN(sized.mintRaw),
      );
      const mintIx = await mintBuilder.instruction();
      ixs.push(mintIx);
    }

    ixs.push(placeIx);

    // Sell No immediate: append merge_pair after Phoenix place (same tx).
    if (plan.needsMerge && !plan.mergeBlocked) {
      if (!ctx.program || !ctx.mintAccounts) {
        return {
          ok: false,
          reason: "merge-accounts-missing",
          message:
            "Sell No immediate merge requires Meridian merge accounts (same set as mint: strikeMarket, vault, yes/no mints, treasury, collateral).",
          mapped,
          plan,
        };
      }
      const mergeBuilder = await buildMergeIx(
        ctx.program,
        ctx.mintAccounts,
        new BN(sized.mintRaw),
      );
      const mergeIx = await mergeBuilder.instruction();
      ixs.push(mergeIx);
    }

    const tx = new Transaction().add(...ixs);
    tx.feePayer = ctx.publicKey;
    const latest = await ctx.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;

    const signature = await ctx.sendTransaction(tx, ctx.connection, {
      skipPreflight: false,
    });

    let message = `Submitted ${plan.packaging} (${plan.phoenixSide} Yes @ ${limitYes.toFixed(2)} × ${plan.size}).`;
    if (plan.needsMint) {
      message += " Mint + ask packed in one tx (transient Yes+No OK).";
    }
    if (plan.needsMerge && !plan.mergeBlocked) {
      message += " Bid + merge_pair packed in one tx (immediate Sell No).";
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
      swept: sweep.length > 0,
      blockhash: latest,
    };
  } catch (e) {
    if (e instanceof SizeNotLotAlignedError) {
      return { ok: false, reason: "invalid-size", message: e.message, mapped, plan };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const detail = withProgramLogs(msg, e);
    // Paused first: simulation logs embedded in the message must never read as a wallet "cancel".
    const rejected =
      !isPhoenixMarketPausedError(detail) &&
      (/reject|denied|cancel/i.test(msg) || msg.includes("User rejected"));
    if (rejected) {
      return { ok: false, reason: "user-rejected", message: "Wallet rejected the transaction.", mapped, plan };
    }
    const explained = explainPlaceError(detail, {
      intent: req.intent,
      orderType: plan.orderType,
      size: plan.size,
      worstPrice: req.worstPrice,
    });
    // No program logs (some wallets drop them): a bare InvalidAccountData from a book that now reads
    // Paused is the paused-at-expiry refusal.
    const paused = explained ? null : await pausedCopyForFailedPlace(ctx.connection, req.phoenixMarket, msg);
    if (paused) {
      return { ok: false, reason: "market-paused", message: paused, mapped, plan };
    }
    return {
      ok: false,
      reason: explained?.reason ?? "sdk-error",
      message: explained?.message ?? `Phoenix place failed: ${msg}`,
      mapped,
      plan,
    };
  }
}

/** Append program logs carried by SendTransactionError (`.logs`) or a wallet-adapter wrapper (`.error.logs`). */
function withProgramLogs(msg: string, e: unknown): string {
  const logs: string[] = [];
  const collect = (o: unknown) => {
    const l = (o as { logs?: unknown } | null | undefined)?.logs;
    if (Array.isArray(l)) logs.push(...l.filter((x): x is string => typeof x === "string"));
  };
  collect(e);
  collect((e as { error?: unknown } | null | undefined)?.error);
  collect((e as { cause?: unknown } | null | undefined)?.cause);
  return logs.length ? `${msg}\n${logs.join("\n")}` : msg;
}

/**
 * Paused-book copy for a failed place when the error carries no Phoenix log: only for Phoenix's
 * InvalidAccountData, and only if the book header now reads Paused (e.g. the expiry pause landed
 * between simulation and confirmation). Null otherwise, or when the read fails.
 */
export async function pausedCopyForFailedPlace(
  connection: Pick<Connection, "getAccountInfo"> | undefined,
  phoenixMarket: string | undefined,
  error: string,
): Promise<string | null> {
  if (!/invalid account data|InvalidAccountData/i.test(error)) return null;
  if (!connection?.getAccountInfo || !hasPhoenixMarketPubkey(phoenixMarket)) return null;
  try {
    const info = await connection.getAccountInfo(new PublicKey(phoenixMarket!), {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 16 },
    });
    if (!info || info.data.length < 16) return null;
    const status = Number(Buffer.from(info.data).readBigUInt64LE(8));
    return status === PHOENIX_STATUS_PAUSED ? PHOENIX_MARKET_PAUSED_MESSAGE : null;
  } catch {
    return null;
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
    const market = new PublicKey(phoenixMarket!);
    const { client } = await loadPhoenixClient(connection, [market]);
    const key = market.toBase58();
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
  } catch (e) {
    logChainReadError("phoenix.book", e, { phoenixMarket });
    return null;
  }
}
