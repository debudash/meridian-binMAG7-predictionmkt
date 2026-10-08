/**
 * Wallet history from on-chain transactions (DLV-088) — pure classifier.
 *
 * Input: the wallet's own signed transactions (getSignaturesForAddress(owner) →
 * getParsedTransactions). Each is classified from its top-level instructions (Meridian Anchor
 * discriminator, Phoenix instruction tag) and the wallet's token-balance deltas for known market
 * mints + USDC. Fills of resting orders made by OTHER traders' txs credit the Phoenix seat and
 * show up here when the wallet cancels / withdraws.
 */
import { utils } from "@coral-xyz/anchor";
import type { MarketView } from "@/lib/market/types";
import { MERIDIAN_IDL } from "@/lib/solana/idl";

export type HistoryType = "trade" | "order" | "cancel" | "withdraw" | "redemption" | "mint" | "merge" | "settlement";

export interface HistoryRow {
  id: string;
  /** Tx signature (undefined for synthesized settlement rows) */
  sig?: string;
  ts: number;
  type: HistoryType;
  marketId: string;
  marketLabel: string;
  intent: string;
  side?: "yes" | "no";
  /** Contracts (side terms) */
  size?: number;
  /** Avg price in side terms (fills only) / settlement price for settlements */
  price?: number;
  yesDelta: number;
  noDelta: number;
  usdcDelta: number;
}

export interface HistoryIndex {
  byMint: Map<string, { market: MarketView; kind: "yes" | "no" }>;
  byPhoenix: Map<string, MarketView>;
  usdcMint?: string;
  meridianProgramId: string;
  phoenixProgramId: string;
  /** hex(8-byte Anchor discriminator) → ix name */
  meridianIx: Map<string, string>;
}

export function buildHistoryIndex(
  markets: readonly MarketView[],
  opts: { usdcMint?: string; meridianProgramId: string; phoenixProgramId: string },
): HistoryIndex {
  const byMint = new Map<string, { market: MarketView; kind: "yes" | "no" }>();
  const byPhoenix = new Map<string, MarketView>();
  for (const m of markets) {
    if (m.yesMint) byMint.set(m.yesMint, { market: m, kind: "yes" });
    if (m.noMint) byMint.set(m.noMint, { market: m, kind: "no" });
    if (m.phoenixMarket) byPhoenix.set(m.phoenixMarket, m);
  }
  const meridianIx = new Map<string, string>();
  for (const ix of (MERIDIAN_IDL as { instructions?: { name: string; discriminator?: number[] }[] }).instructions ?? []) {
    if (ix.discriminator) meridianIx.set(Buffer.from(ix.discriminator).toString("hex"), ix.name);
  }
  return { byMint, byPhoenix, ...opts, meridianIx };
}

/* Phoenix V1 instruction tags (phoenix-sdk instructions/*Discriminator). */
const PHX_TRADE = new Set([0, 1, 2, 3, 16, 17]); // Swap*, PlaceLimitOrder*, PlaceMultiplePostOnly*
const PHX_CANCEL = new Set([4, 5, 6, 7, 8, 9, 10, 11]); // ReduceOrder*, CancelAll*, CancelUpTo*, CancelMultipleById*
const PHX_WITHDRAW = 12;

interface ParsedIxLike {
  programId: { toString(): string } | string;
  accounts?: ({ toString(): string } | string)[];
  data?: string;
}
interface TokenBalanceLike {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null; uiAmountString?: string };
}
export interface ParsedTxLike {
  blockTime?: number | null;
  meta: { err: unknown; preTokenBalances?: TokenBalanceLike[] | null; postTokenBalances?: TokenBalanceLike[] | null } | null;
  transaction: { message: { instructions: ParsedIxLike[] } };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const amt = (b: TokenBalanceLike) => b.uiTokenAmount.uiAmount ?? Number(b.uiTokenAmount.uiAmountString ?? 0);

function ownerDeltas(tx: ParsedTxLike, owner: string): Map<string, number> {
  const d = new Map<string, number>();
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.owner === owner) d.set(b.mint, (d.get(b.mint) ?? 0) - amt(b));
  for (const b of tx.meta?.postTokenBalances ?? []) if (b.owner === owner) d.set(b.mint, (d.get(b.mint) ?? 0) + amt(b));
  return d;
}

function decode(data?: string): Buffer {
  try {
    return data ? Buffer.from(utils.bytes.bs58.decode(data)) : Buffer.alloc(0);
  } catch {
    return Buffer.alloc(0);
  }
}

export function classifyTransaction(
  sig: string,
  tx: ParsedTxLike | null,
  owner: string,
  idx: HistoryIndex,
): HistoryRow | null {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const meridian = new Set<string>();
  const phoenixTags = new Set<number>();
  let phoenixMarket: MarketView | undefined;
  for (const ix of tx.transaction.message.instructions) {
    const pid = ix.programId.toString();
    if (pid === idx.meridianProgramId) {
      const name = idx.meridianIx.get(decode(ix.data).subarray(0, 8).toString("hex"));
      if (name) meridian.add(name);
    } else if (pid === idx.phoenixProgramId) {
      const data = decode(ix.data);
      if (data.length) phoenixTags.add(data[0]);
      const mk = ix.accounts?.[2]?.toString();
      if (mk && idx.byPhoenix.has(mk)) phoenixMarket = idx.byPhoenix.get(mk);
    }
  }

  const deltas = ownerDeltas(tx, owner);
  let market = phoenixMarket;
  let yesDelta = 0;
  let noDelta = 0;
  for (const [mint, delta] of deltas) {
    const hit = idx.byMint.get(mint);
    if (!hit || (market && hit.market.marketId !== market.marketId)) continue;
    market = hit.market;
    if (hit.kind === "yes") yesDelta += delta;
    else noDelta += delta;
  }
  if (!market) return null;
  yesDelta = r6(yesDelta);
  noDelta = r6(noDelta);
  const usdcDelta = r6(idx.usdcMint ? deltas.get(idx.usdcMint) ?? 0 : 0);

  const isTrade = [...phoenixTags].some((t) => PHX_TRADE.has(t));
  const isCancel = [...phoenixTags].some((t) => PHX_CANCEL.has(t));
  const isWithdraw = phoenixTags.has(PHX_WITHDRAW);

  const base = {
    id: sig,
    sig,
    ts: tx.blockTime ?? 0,
    marketId: market.marketId,
    marketLabel: market.question,
    yesDelta,
    noDelta,
    usdcDelta,
  };
  const px = (qty: number) => (qty > 0 && usdcDelta !== 0 ? r6(Math.abs(usdcDelta) / qty) : undefined);

  if (meridian.has("redeem")) {
    const side = yesDelta < 0 ? "yes" : "no";
    return { ...base, type: "redemption", intent: side === "yes" ? "Redeem Yes" : "Redeem No", side, size: Math.abs(side === "yes" ? yesDelta : noDelta), price: 1 };
  }
  if (isTrade) {
    if (meridian.has("mint")) {
      // Buy No: mint pair, sell the Yes on Phoenix. Paid 1/pair − Yes proceeds.
      const p = px(noDelta);
      const resting = p == null || p >= 0.999;
      return { ...base, type: resting ? "order" : "trade", intent: resting ? "Buy No (resting)" : "Buy No", side: "no", size: noDelta, price: resting ? undefined : p };
    }
    if (meridian.has("merge_pair")) {
      return { ...base, type: "trade", intent: "Sell No", side: "no", size: Math.abs(noDelta), price: px(Math.abs(noDelta)) };
    }
    if (yesDelta > 0) return { ...base, type: "trade", intent: "Buy Yes", side: "yes", size: yesDelta, price: px(yesDelta) };
    if (yesDelta < 0 && usdcDelta > 0) return { ...base, type: "trade", intent: "Sell Yes", side: "yes", size: -yesDelta, price: px(-yesDelta) };
    if (yesDelta < 0) return { ...base, type: "order", intent: "Limit ask (resting)", side: "yes", size: -yesDelta };
    return { ...base, type: "order", intent: "Limit bid (resting)", side: "yes" };
  }
  if (isCancel) return { ...base, type: "cancel", intent: "Cancel order" };
  if (isWithdraw) return { ...base, type: "withdraw", intent: "Withdraw from Phoenix" };
  if (meridian.has("merge_pair")) return { ...base, type: "merge", intent: "Merge Yes+No → USDC", size: Math.abs(noDelta) };
  if (meridian.has("mint")) return { ...base, type: "mint", intent: "Mint Yes+No", size: noDelta };
  return null;
}

/** Synthesized settlement rows for settled markets the wallet has activity in. */
export function settlementRows(markets: readonly MarketView[], tradedMarketIds: ReadonlySet<string>): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const m of markets) {
    if (!tradedMarketIds.has(m.marketId)) continue;
    if (m.status !== "settled-yes" && m.status !== "settled-no") continue;
    const yes = m.status === "settled-yes";
    out.push({
      id: `settle-${m.marketId}`,
      ts: m.resolvedAt ?? m.settleTs,
      type: "settlement",
      marketId: m.marketId,
      marketLabel: m.question,
      intent: yes ? "Result: Yes" : "Result: No",
      side: yes ? "yes" : "no",
      price: m.resolvedPrice,
      yesDelta: 0,
      noDelta: 0,
      usdcDelta: 0,
    });
  }
  return out;
}
