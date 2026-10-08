/**
 * DLV-116 — docs/ui/08-price-display.md (rules from Meridian UI; 08 not on main yet).
 *
 * One place for what a price control shows:
 *  - Controls show EXECUTABLE prices only: Buy Yes = best Yes ask, Buy No = 1 − best Yes bid,
 *    Sell Yes = best Yes bid, Sell No = 1 − best Yes ask (Sell* on the ticket only).
 *  - Mid is never shown as a bare 0.xx, only as `NN% implied` (from mid only when both sides exist,
 *    else `NN% implied (last trade)`, else `—`).
 *  - Buy Yes + Buy No = 1 + spread (never claim 1.00); only implied Yes + No = 100%.
 *  - Caps: executables 0.01–0.99 (on the tick grid), implied 1–99% (never 100% from 0.995).
 * Integer-tick math via bookTransform (toTicks / fromTicks / noPriceFromYes).
 */
import { fromTicks, noPriceFromYes, toTicks } from "./bookTransform";
import type { MarketView, OrderBookSnapshot } from "./types";

export type ExecIntent = "buy-yes" | "buy-no" | "sell-yes" | "sell-no";

export const NO_SELLERS_TITLE = "No sellers right now — set a limit price";
export const NO_BUYERS_TITLE = "No buyers right now";

export interface PriceDisplayInput {
  bestBid?: number;
  bestAsk?: number;
  lastYes?: number;
  tickSize?: number;
  /** false = closed / settled: no executables. */
  open?: boolean;
}

export interface PriceDisplay {
  tickSize: number;
  open: boolean;
  exec: Record<ExecIntent, number | undefined>;
  /** 1–99 */
  impliedPct?: number;
  impliedSource: "mid" | "last" | "none";
  spread?: number;
}

const DEFAULT_TICK = 0.01;
const EPS = 1e-9;

function tickDecimals(tick: number): number {
  return Math.max(2, (String(tick).split(".")[1] ?? "").length);
}

/** Tick-grid value without float noise (e.g. 23 × 0.025). */
function clean(ticks: number, tick: number): number {
  return Number(fromTicks(ticks, tick).toFixed(tickDecimals(tick)));
}

function capTicks(ticks: number, tick: number): number {
  const lo = Math.ceil(0.01 / tick - EPS);
  const hi = Math.floor(0.99 / tick + EPS);
  return Math.min(hi, Math.max(lo, ticks));
}

function capPct(pct: number): number {
  return Math.min(99, Math.max(1, pct));
}

export function priceDisplay(input: PriceDisplayInput): PriceDisplay {
  const tick = input.tickSize && input.tickSize > 0 ? input.tickSize : DEFAULT_TICK;
  const open = input.open ?? true;
  const bidT = input.bestBid != null ? toTicks(input.bestBid, tick) : undefined;
  const askT = input.bestAsk != null ? toTicks(input.bestAsk, tick) : undefined;
  const px = (t: number | undefined) => (t == null ? undefined : clean(capTicks(t, tick), tick));
  // No prices via noPriceFromYes on the tick grid (1 − p), then capped.
  const inv = (t: number | undefined) =>
    t == null ? undefined : px(toTicks(noPriceFromYes(fromTicks(t, tick), tick), tick));
  const exec: Record<ExecIntent, number | undefined> = open
    ? { "buy-yes": px(askT), "buy-no": inv(bidT), "sell-yes": px(bidT), "sell-no": inv(askT) }
    : { "buy-yes": undefined, "buy-no": undefined, "sell-yes": undefined, "sell-no": undefined };

  let impliedPct: number | undefined;
  let impliedSource: PriceDisplay["impliedSource"] = "none";
  let spread: number | undefined;
  if (bidT != null && askT != null) {
    // mid% = (bid + ask) / 2 × 100, half up, computed from ticks.
    impliedPct = capPct(Math.round((bidT + askT) * tick * 50 + EPS));
    impliedSource = "mid";
    spread = clean(Math.max(0, askT - bidT), tick);
  } else if (input.lastYes != null) {
    impliedPct = capPct(Math.round(input.lastYes * 100 + EPS));
    impliedSource = "last";
  }
  return { tickSize: tick, open, exec, impliedPct, impliedSource, spread };
}

export function formatPrice(p: number | undefined, tickSize = DEFAULT_TICK): string {
  return p == null ? "—" : p.toFixed(tickDecimals(tickSize));
}

export function execLabel(d: PriceDisplay, intent: ExecIntent): string {
  return formatPrice(d.exec[intent], d.tickSize);
}

/** Tooltip when that side of the book is empty (control stays enabled for a limit order). */
export function execTitle(d: PriceDisplay, intent: ExecIntent): string | undefined {
  if (!d.open || d.exec[intent] != null) return undefined;
  return intent.startsWith("buy") ? NO_SELLERS_TITLE : NO_BUYERS_TITLE;
}

export function impliedText(d: PriceDisplay): string {
  if (d.impliedPct == null) return "—";
  return d.impliedSource === "last" ? `${d.impliedPct}% implied (last trade)` : `${d.impliedPct}% implied`;
}

/** Book spread row: `Spread 0.02 · 42% implied`; null when a side is empty. */
export function spreadText(d: PriceDisplay): string | null {
  if (d.spread == null || d.impliedSource !== "mid") return null;
  return `Spread ${formatPrice(d.spread, d.tickSize)} · ${impliedText(d)}`;
}

/**
 * Market adapter. A live book (trade page) replaces the market snapshot entirely, so a side that
 * emptied isn't backfilled with a stale quote. `yesMid` is never used.
 */
export function marketPriceDisplay(
  market: Pick<MarketView, "yesBid" | "yesAsk" | "lastYes" | "tickSize" | "status">,
  opts: { book?: Pick<OrderBookSnapshot, "bids" | "asks"> | null; open?: boolean } = {},
): PriceDisplay {
  const bestBid = opts.book ? opts.book.bids[0]?.price : market.yesBid;
  const bestAsk = opts.book ? opts.book.asks[0]?.price : market.yesAsk;
  return priceDisplay({
    bestBid,
    bestAsk,
    lastYes: market.lastYes,
    tickSize: market.tickSize,
    open: market.status === "open" && (opts.open ?? true),
  });
}

/* ---- surface view models ---- */

export interface PriceCell {
  price: string;
  title?: string;
}

/** Card / table / ladder Buy buttons (Buy only on list surfaces). */
export function buyButtonPrices(d: PriceDisplay): { yes: PriceCell; no: PriceCell; implied: string } {
  return {
    yes: { price: execLabel(d, "buy-yes"), title: execTitle(d, "buy-yes") },
    no: { price: execLabel(d, "buy-no"), title: execTitle(d, "buy-no") },
    implied: impliedText(d),
  };
}

export interface PillContent {
  label: string;
  /** Executable price; null when closed / settled (no executables). */
  price: string | null;
  text: string;
  title?: string;
}

/** Trade header pills (still the perspective toggle) + a separate implied label. */
export function headerPills(d: PriceDisplay): { yes: PillContent; no: PillContent; implied: string | null } {
  if (!d.open) {
    return {
      yes: { label: "Yes", price: null, text: "Yes", title: undefined },
      no: { label: "No", price: null, text: "No", title: undefined },
      implied: null,
    };
  }
  const pill = (side: "yes" | "no"): PillContent => {
    const intent: ExecIntent = side === "yes" ? "buy-yes" : "buy-no";
    const label = side === "yes" ? "Buy Yes" : "Buy No";
    const price = execLabel(d, intent);
    return { label, price, text: `${label} ${price}`, title: execTitle(d, intent) };
  };
  return { yes: pill("yes"), no: pill("no"), implied: impliedText(d) };
}

/** Ticket 2×2: executable price under each intent label. */
export function ticketIntentPrices(d: PriceDisplay): Record<ExecIntent, PriceCell> {
  const cell = (i: ExecIntent): PriceCell => ({ price: execLabel(d, i), title: execTitle(d, i) });
  return { "buy-yes": cell("buy-yes"), "sell-yes": cell("sell-yes"), "buy-no": cell("buy-no"), "sell-no": cell("sell-no") };
}
