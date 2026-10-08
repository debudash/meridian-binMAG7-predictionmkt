/**
 * On-book sim trade path for localnet (DLV-064).
 *
 * Preferred path for Buy/Sell Yes/No under sim:
 *  1. Plan intent via phoenix_compose (mirrors apps/web client).
 *  2. Optional Meridian mint (Buy No).
 *  3. Execute a **book-sim fill** — counterparty Yes↔USDC swap at planned
 *     yesPrice. Models Phoenix match economics without a Meridian matcher
 *     (ARCHITECTURE: no CPI wrap of Phoenix).
 *  4. Optional Meridian merge_pair (Sell No immediate).
 *
 * Real Phoenix CLOB: when `PHOENIX_ONBOOK_MODE=phoenix` and a live market +
 * program are configured, callers should use the web SDK place path instead.
 * This harness path is the **maximum viable localnet E2E** while full Phoenix
 * market create on solana-test-validator remains residual (see
 * docs/TEST_MATRIX.md (PHX cases)).
 *
 * Off-book Yes SPL transfer (`simTradeOffBook`) is demoted to non-prod fallback.
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  planIntentComposition,
  quoteAtomsForYesFill,
  contractsToRaw,
  type PhoenixIntent,
  type PhoenixOrderType,
  type ComposePlan,
} from "./phoenix_compose";
import type { TestCtx } from "./harness";

export type OnBookMode = "book-sim" | "off-book-fallback" | "phoenix";

export function resolveOnBookMode(): OnBookMode {
  const m = (process.env.PHOENIX_ONBOOK_MODE ?? "book-sim").toLowerCase();
  if (m === "phoenix") return "phoenix";
  if (m === "off-book" || m === "off-book-fallback") return "off-book-fallback";
  return "book-sim";
}

export interface SimTradeOnBookOpts {
  intent: PhoenixIntent;
  /** Intent-side price (Yes terms for Yes intents; No terms for No intents) */
  price: number;
  /** Human contracts (default 1 → 1e6 raw at 6 decimals) */
  size?: number;
  orderType?: PhoenixOrderType;
  /** Taker; defaults to ctx.user */
  taker?: Keypair;
  /**
   * Liquidity provider / counterparty. If omitted, a fresh funded second user
   * is booted and seeded with inventory as needed for the fill.
   */
  counterparty?: Keypair;
}

export interface SimTradeOnBookResult {
  mode: OnBookMode;
  plan: ComposePlan;
  baseRaw: BN;
  quoteRaw: BN;
  counterparty: PublicKey;
  notes: string[];
}

async function ensureAta(
  ctx: TestCtx,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey = ctx.authority.publicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  try {
    await getAccount(ctx.provider.connection, ata);
  } catch {
    await ctx.provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(payer, ata, owner, mint)
      )
    );
  }
  return ata;
}

async function transferSpl(
  ctx: TestCtx,
  mint: PublicKey,
  from: Keypair,
  to: PublicKey,
  amount: bigint
) {
  const src = getAssociatedTokenAddressSync(mint, from.publicKey);
  const dst = await ensureAta(ctx, mint, to);
  await ctx.provider.sendAndConfirm(
    new Transaction().add(
      createTransferInstruction(src, dst, from.publicKey, amount, [], TOKEN_PROGRAM_ID)
    ),
    [from]
  );
}

/**
 * Seed counterparty so they can take the opposite side of `plan`.
 * - Taker bids (buys Yes): CP must hold Yes → mint for CP.
 * - Taker asks (sells Yes): CP must hold USDC (bootSecondUser already funds USDC).
 */
async function seedCounterpartyForFill(
  ctx: TestCtx,
  plan: ComposePlan,
  baseRaw: BN,
  cp: Keypair
) {
  if (plan.phoenixSide === "bid") {
    // CP sells Yes into taker's bid → needs Yes inventory
    const yesBal = await ctx.tokenBal(getAssociatedTokenAddressSync(ctx.yesMint, cp.publicKey));
    if (yesBal.lt(baseRaw)) {
      const need = baseRaw.sub(yesBal);
      await ctx.mint(need, cp);
    }
  }
  // ask side: CP buys Yes with USDC — bootSecondUser funds collateral ATA
}

/**
 * Execute one immediate fill at plan.yesPrice between taker and counterparty.
 * Does **not** touch Meridian vault / pairs_* (SCHEMA §7.7 / V-08 twin).
 */
export async function executeBookSimFill(
  ctx: TestCtx,
  plan: ComposePlan,
  baseRaw: BN,
  taker: Keypair,
  counterparty: Keypair
): Promise<BN> {
  const quote = new BN(
    quoteAtomsForYesFill(BigInt(baseRaw.toString()), plan.yesPrice).toString()
  );
  await seedCounterpartyForFill(ctx, plan, baseRaw, counterparty);

  if (plan.phoenixSide === "bid") {
    // Taker buys Yes: USDC taker→CP, Yes CP→taker
    await transferSpl(
      ctx,
      ctx.collateralMint,
      taker,
      counterparty.publicKey,
      BigInt(quote.toString())
    );
    await transferSpl(ctx, ctx.yesMint, counterparty, taker.publicKey, BigInt(baseRaw.toString()));
  } else {
    // Taker sells Yes: Yes taker→CP, USDC CP→taker
    await transferSpl(ctx, ctx.yesMint, taker, counterparty.publicKey, BigInt(baseRaw.toString()));
    await transferSpl(
      ctx,
      ctx.collateralMint,
      counterparty,
      taker.publicKey,
      BigInt(quote.toString())
    );
  }
  return quote;
}

/**
 * Preferred sim trade: compose → optional mint → book-sim fill → optional merge.
 * Replaces off-book Yes SPL placeholder for Buy/Sell No demo paths.
 */
export async function simTradeOnBook(
  ctx: TestCtx,
  opts: SimTradeOnBookOpts
): Promise<SimTradeOnBookResult> {
  const mode = resolveOnBookMode();
  if (mode === "phoenix") {
    throw new Error(
      "PHOENIX_ONBOOK_MODE=phoenix requires a live Phoenix market on this validator. " +
        "Full Phoenix CLOB localnet create is not wired in this harness — see docs/TEST_MATRIX.md (PHX cases). " +
        "Use default PHOENIX_ONBOOK_MODE=book-sim for localnet E2E."
    );
  }
  if (mode === "off-book-fallback") {
    throw new Error(
      "off-book-fallback requested via env — call ctx.simTradeOffBook explicitly " +
        "(demoted non-prod path). Prefer simTradeOnBook with book-sim."
    );
  }

  const orderType = opts.orderType ?? "market";
  const size = opts.size ?? 1;
  const plan = planIntentComposition({
    intent: opts.intent,
    price: opts.price,
    size,
    orderType,
  });
  const baseRaw = new BN(contractsToRaw(size).toString());
  const taker = opts.taker ?? ctx.user;

  let cp = opts.counterparty;
  if (!cp) {
    const boot = await ctx.bootSecondUser();
    cp = boot.user;
  }

  const notes = [...plan.notes];

  if (plan.needsMint) {
    await ctx.mint(baseRaw, taker);
    notes.push(`minted ${baseRaw.toString()} Yes+No for Buy No`);
  }

  // For sell-yes / sell-no the taker must already hold inventory.
  const quoteRaw = await executeBookSimFill(ctx, plan, baseRaw, taker, cp);
  notes.push(
    `book-sim fill: ${plan.phoenixSide} Yes @ ${plan.yesPrice} base=${baseRaw.toString()} quote=${quoteRaw.toString()}`
  );

  if (plan.needsMerge && !plan.mergeBlocked) {
    await ctx.mergePair(baseRaw, "PHX-ONBOOK", taker);
    notes.push(`merge_pair ${baseRaw.toString()} (Sell No immediate)`);
  } else if (plan.mergeBlocked) {
    notes.push("resting Sell No: merge skipped (merge-on-fill phased)");
  }

  return {
    mode,
    plan,
    baseRaw,
    quoteRaw,
    counterparty: cp.publicKey,
    notes,
  };
}
