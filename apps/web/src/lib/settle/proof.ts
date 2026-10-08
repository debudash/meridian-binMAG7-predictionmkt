/**
 * Settle replay proof (DLV-076) — pure parsing + view-model. No RPC here.
 *
 * What is on-chain (no program change, D-023):
 * - StrikeMarket: status, settlement_price_e6, settled_at_ts, settled_slot,
 *   strike_price_e6, pyth_price_feed (account), pyth_feed_id ([u8;32]).
 * - `Settled` / `AdminSettled` events (Anchor `emit!` → "Program data: <b64>" log):
 *   market, settlement_price_e6, strike_price_e6, outcome_yes, pyth_conf (raw Pyth
 *   mantissa), slot, ts (+ authority for AdminSettled).
 * - NOT stored anywhere: the Pyth publish time/slot of the price used, the Pyth expo
 *   (conf is converted with the feed account's current expo), and the settle tx
 *   signature (found via getSignaturesForAddress on the market + log scan).
 */
import { PublicKey } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";

/** Anchor event discriminators (idl/meridian.prod.json `events`). */
export const SETTLED_DISCRIMINATOR = [232, 210, 40, 17, 142, 124, 145, 238];
export const ADMIN_SETTLED_DISCRIMINATOR = [222, 27, 131, 145, 215, 177, 205, 124];

export interface SettleEvent {
  kind: "pyth" | "admin";
  market: string;
  settlementPriceE6: bigint;
  strikePriceE6: bigint;
  outcomeYes: boolean;
  /** Raw Pyth conf mantissa (0 for admin settle) */
  pythConf: bigint;
  slot: number;
  ts: number;
  authority?: string;
}

function matches(buf: Uint8Array, disc: number[]): boolean {
  return buf.length >= 8 && disc.every((b, i) => buf[i] === b);
}

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Decode one Anchor event payload (discriminator + borsh) if it is Settled/AdminSettled. */
export function decodeSettleEvent(bytes: Uint8Array): SettleEvent | null {
  const isPyth = matches(bytes, SETTLED_DISCRIMINATOR);
  const isAdmin = !isPyth && matches(bytes, ADMIN_SETTLED_DISCRIMINATOR);
  if (!isPyth && !isAdmin) return null;
  const need = 8 + 32 + 8 + 8 + 1 + 8 + 8 + 8 + (isAdmin ? 32 : 0);
  if (bytes.length < need) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  const market = new PublicKey(bytes.subarray(o, o + 32)).toBase58();
  o += 32;
  const settlementPriceE6 = dv.getBigUint64(o, true);
  o += 8;
  const strikePriceE6 = dv.getBigUint64(o, true);
  o += 8;
  const outcomeYes = bytes[o] === 1;
  o += 1;
  const pythConf = dv.getBigUint64(o, true);
  o += 8;
  const slot = Number(dv.getBigUint64(o, true));
  o += 8;
  const ts = Number(dv.getBigInt64(o, true));
  o += 8;
  const authority = isAdmin ? new PublicKey(bytes.subarray(o, o + 32)).toBase58() : undefined;
  return {
    kind: isPyth ? "pyth" : "admin",
    market,
    settlementPriceE6,
    strikePriceE6,
    outcomeYes,
    pythConf,
    slot,
    ts,
    authority,
  };
}

/** Scan tx log lines for a Settled/AdminSettled event for `marketId`. */
export function parseSettleEventFromLogs(
  logs: readonly string[] | null | undefined,
  marketId: string,
): SettleEvent | null {
  if (!logs) return null;
  for (const line of logs) {
    const m = /^Program data: (.+)$/.exec(line.trim());
    if (!m) continue;
    const bytes = b64ToBytes(m[1]);
    if (!bytes) continue;
    const ev = decodeSettleEvent(bytes);
    if (ev && ev.market === marketId) return ev;
  }
  return null;
}

export interface SettleProofLinks {
  txUrl?: string;
  priceAccountUrl?: string;
  /** Hermes latest-price JSON for the feed id (real Pyth feeds only) */
  feedUrl?: string;
}

export interface SettleProofView {
  status: "settled" | "settling" | "void";
  outcome?: "yes" | "no";
  kind?: "pyth" | "admin";
  symbol: string;
  strike: number;
  settlementPrice?: number;
  /** "≥" or "<" */
  comparator?: "≥" | "<";
  /** "$231.50 ≥ $230.00 → Yes wins" */
  comparisonLine?: string;
  /** True when on-chain outcome agrees with price ≥ strike (D-005) */
  consistent?: boolean;
  /** Human confidence (needs feed expo), e.g. 0.05 */
  conf?: number;
  confRaw?: bigint;
  settledAt?: number;
  settledSlot?: number;
  signature?: string;
  blockTime?: number;
  feedIdHex?: string;
  priceAccount?: string;
  links: SettleProofLinks;
  /** Plain notes on what could not be proven from chain data */
  notes: string[];
}

export function hermesFeedUrl(feedIdHex: string): string {
  return `https://hermes.pyth.network/v2/updates/price/latest?ids[]=0x${feedIdHex}`;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function buildSettleProof(args: {
  market: Pick<
    MarketView,
    | "status"
    | "underlyingSymbol"
    | "strike"
    | "resolvedPrice"
    | "resolvedAt"
    | "pythFeedId"
    | "pythFeedIdHex"
    | "settledSlot"
  >;
  event?: SettleEvent | null;
  signature?: string | null;
  blockTime?: number | null;
  /** Feed expo (from the price account) to scale `pyth_conf`; undefined = unknown */
  feedExpo?: number;
  /** True when the price account is the localnet mock (feed id is not a real Pyth id) */
  mockFeed?: boolean;
  /** False while the tx lookup is still running (suppresses the "not found" note) */
  lookupDone?: boolean;
  explorerTx?: (sig: string) => string;
  explorerAddress?: (addr: string) => string;
}): SettleProofView {
  const { market, event, signature, blockTime, feedExpo, mockFeed } = args;
  const notes: string[] = [];
  const status: SettleProofView["status"] =
    market.status === "void" ? "void" : market.status === "settling" ? "settling" : "settled";
  const outcome =
    market.status === "settled-yes" ? "yes" : market.status === "settled-no" ? "no" : undefined;

  const settlementPrice =
    event != null ? Number(event.settlementPriceE6) / 1e6 : market.resolvedPrice;
  const strike = event != null ? Number(event.strikePriceE6) / 1e6 : market.strike;

  let comparator: SettleProofView["comparator"];
  let comparisonLine: string | undefined;
  let consistent: boolean | undefined;
  if (settlementPrice != null && status === "settled") {
    const yesWins = settlementPrice >= strike; // D-005
    comparator = yesWins ? "≥" : "<";
    comparisonLine = `${money(settlementPrice)} ${comparator} ${money(strike)} → ${yesWins ? "Yes" : "No"} wins`;
    consistent = outcome == null ? undefined : (outcome === "yes") === yesWins;
    if (event && event.outcomeYes !== yesWins) consistent = false;
    if (consistent === false) notes.push("On-chain outcome does not match price ≥ strike — investigate.");
  }

  let conf: number | undefined;
  if (event?.kind === "pyth") {
    if (feedExpo != null) conf = Number(event.pythConf) * Math.pow(10, feedExpo);
    else notes.push("Confidence shown raw (Pyth exponent unavailable).");
  }
  if (event?.kind === "admin") {
    notes.push("Settled by admin fallback (no Pyth read; price checked against strike on-chain).");
  }

  if (status === "settled") {
    if (!event && args.lookupDone !== false) {
      notes.push(
        "Settle transaction not found in RPC history (pruned or not yet indexed); values are from the market account.",
      );
    }
    if (event?.kind !== "admin") {
      notes.push("Pyth publish time isn't stored on-chain; settle required it within 150 slots (D-005).");
    }
  }

  const feedIdHex = market.pythFeedIdHex;
  const links: SettleProofLinks = {};
  if (signature && args.explorerTx) links.txUrl = args.explorerTx(signature);
  if (market.pythFeedId && args.explorerAddress) links.priceAccountUrl = args.explorerAddress(market.pythFeedId);
  if (feedIdHex && !mockFeed) links.feedUrl = hermesFeedUrl(feedIdHex);

  return {
    status,
    outcome,
    kind: event?.kind,
    symbol: market.underlyingSymbol,
    strike,
    settlementPrice,
    comparator,
    comparisonLine,
    consistent,
    conf,
    confRaw: event?.pythConf,
    settledAt: market.resolvedAt ?? event?.ts,
    settledSlot: market.settledSlot ?? event?.slot,
    signature: signature ?? undefined,
    blockTime: blockTime ?? undefined,
    feedIdHex,
    priceAccount: market.pythFeedId,
    links,
    notes,
  };
}

/**
 * Order candidate signatures for the settle scan: exact slot match first (wall-clock
 * settle writes settled_slot = tx slot), then newest → oldest. Failed txs dropped.
 */
export function orderSettleCandidates<T extends { signature: string; slot: number; err?: unknown }>(
  sigs: readonly T[],
  settledSlot?: number,
): T[] {
  const ok = sigs.filter((s) => s.err == null);
  if (settledSlot == null) return ok;
  const exact = ok.filter((s) => s.slot === settledSlot);
  const rest = ok.filter((s) => s.slot !== settledSlot);
  return [...exact, ...rest];
}
