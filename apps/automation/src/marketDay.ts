/**
 * DLV-118 (SPEC §1 / §3.3): same-day 0DTE MAG7 markets expire at TODAY's 16:00 America/New_York close.
 *
 * Pure helpers (no RPC), shared by:
 *   - the calendar worker (create at the 9:30 ET open → expiry = that day's 16:00 ET close),
 *   - ops/run-staging.sh + ops/devnet-bootstrap.cjs via `ops-cli market-day` (no more fixed next-close books),
 *   - scripts/localnet/today-markets.cjs (effective clock = SimClock when enabled, else chain time).
 *
 * Rules:
 *   - expiry = 16:00:00 America/New_York on the ET calendar day of `now` (DST via Intl, never a fixed offset);
 *   - at/after that close → REJECT (`after_close`), never roll to the next day silently (SPEC: same-day only);
 *     the next trading day's run creates that day's markets;
 *   - weekends / NYSE full-day holidays → REJECT unless `allowNonTradingDay` (localnet override only);
 *   - a year missing from the holiday table → REJECT (`unknown_year`) so ops notices before a wrong expiry ships.
 * Early-close days (13:00 ET, e.g. 2026-11-27 / 2026-12-24) are NOT modelled: V1 keeps the SPEC 16:00 close and the
 * ≥16:00 ET settle gate (open item for PM).
 */
import type { PullPrice } from "./pyth/pullOracle";

export const ET_TZ = "America/New_York";
/** SPEC §1 MAG7 list (order as written there). */
export const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;
export const OPEN_HOUR_ET = 9;
export const OPEN_MINUTE_ET = 30;
export const CLOSE_HOUR_ET = 16;

/** NYSE full-day closures (nyse.com holidays & trading hours). Extend yearly; unknown years refuse. */
export const NYSE_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "Martin Luther King Jr. Day",
  "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (observed)",
  "2027-07-05": "Independence Day (observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day (observed)",
};
export const CALENDAR_YEARS = new Set([2026, 2027]);

export interface EtWall {
  dateKey: string;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

export function etWall(unixSec: number): EtWall {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(unixSec * 1000)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday));
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour, minute: Number(p.minute), second: Number(p.second), weekday };
}

function parseDateKey(dateKey: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new Error(`bad dateKey ${dateKey} (want YYYY-MM-DD)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Unix seconds of `hour:minute` America/New_York wall time on `dateKey` (EST = UTC-5, EDT = UTC-4). */
export function etWallClockToUnix(dateKey: string, hour: number, minute = 0): number {
  const [y, mo, d] = parseDateKey(dateKey);
  for (const offsetH of [4, 5]) {
    const t = Math.floor(Date.UTC(y, mo - 1, d, hour + offsetH, minute, 0) / 1000);
    const w = etWall(t);
    if (w.dateKey === dateKey && w.hour === hour && w.minute === minute) return t;
  }
  throw new Error(`no ET wall time ${dateKey} ${hour}:${minute} (DST gap?)`);
}

export type TradingDayCheck = { ok: true } | { ok: false; code: "weekend" | "holiday" | "unknown_year"; reason: string };

export function isTradingDay(dateKey: string): TradingDayCheck {
  const [y, mo, d] = parseDateKey(dateKey);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return { ok: false, code: "weekend", reason: `${dateKey} is a ${wd === 0 ? "Sunday" : "Saturday"} (no NYSE session)` };
  if (!CALENDAR_YEARS.has(y)) return { ok: false, code: "unknown_year", reason: `NYSE holiday table has no ${y}; extend NYSE_HOLIDAYS in apps/automation/src/marketDay.ts` };
  const h = NYSE_HOLIDAYS[dateKey];
  if (h) return { ok: false, code: "holiday", reason: `${dateKey} is an NYSE holiday (${h})` };
  return { ok: true };
}

function addDays(dateKey: string, n: number): string {
  const [y, mo, d] = parseDateKey(dateKey);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Next NYSE trading day strictly after `dateKey`. */
export function nextTradingDay(dateKey: string): string {
  let k = addDays(dateKey, 1);
  for (let i = 0; i < 14; i++, k = addDays(k, 1)) {
    const t = isTradingDay(k);
    if (t.ok) return k;
    if (t.code === "unknown_year") throw new Error(t.reason);
  }
  throw new Error(`no trading day within 14 days after ${dateKey}`);
}

export interface SessionPlan {
  /** ET calendar day (YYYY-MM-DD) */
  dateKey: string;
  /** 09:30 ET */
  openTs: number;
  /** 16:00 ET = the market's expiry_ts */
  closeTs: number;
}

export type SameDayDecision =
  | { ok: true; plan: SessionPlan }
  | { ok: false; code: "weekend" | "holiday" | "unknown_year" | "after_close" | "before_open"; reason: string; dateKey: string; nextDateKey?: string };

/**
 * The same-day session for `nowSec` (effective clock: SimClock when enabled on localnet, else chain/wall time).
 * Expiry is always that ET day's 16:00 close; after the close this REJECTS (no roll-over).
 */
export function sameDaySession(
  nowSec: number,
  opts: { allowNonTradingDay?: boolean; requireOpen?: boolean } = {},
): SameDayDecision {
  const w = etWall(nowSec);
  const dateKey = w.dateKey;
  const next = () => {
    try {
      return nextTradingDay(dateKey);
    } catch {
      return undefined;
    }
  };
  const td = isTradingDay(dateKey);
  if (!td.ok && !(opts.allowNonTradingDay && td.code !== "unknown_year")) {
    return { ok: false, code: td.code, reason: td.reason, dateKey, nextDateKey: next() };
  }
  const openTs = etWallClockToUnix(dateKey, OPEN_HOUR_ET, OPEN_MINUTE_ET);
  const closeTs = etWallClockToUnix(dateKey, CLOSE_HOUR_ET, 0);
  if (nowSec >= closeTs) {
    return {
      ok: false,
      code: "after_close",
      reason: `${dateKey} 16:00 ET close (${closeTs}) has passed; same-day markets only — not rolling to the next day`,
      dateKey,
      nextDateKey: next(),
    };
  }
  if (opts.requireOpen && nowSec < openTs) {
    return { ok: false, code: "before_open", reason: `before the ${dateKey} 09:30 ET open`, dateKey };
  }
  return { ok: true, plan: { dateKey, openTs, closeTs } };
}

/** ATM strike (reference rounded to the nearest `stepE6`, half-up) plus offsets; every strike must be > 0. */
export function atmStrikesE6(refE6: bigint, offsetsE6: number[], stepE6: bigint): bigint[] {
  if (stepE6 <= 0n) throw new Error("strike step must be > 0");
  const atm = ((refE6 + stepE6 / 2n) / stepE6) * stepE6;
  return offsetsE6.map((o) => {
    const s = atm + BigInt(o);
    if (s <= 0n) throw new Error(`strike_price_e6 must be > 0 (ref=${refE6} offset=${o})`);
    return s;
  });
}

/** Default strike step: $5 at/above $100, $1 below. */
export function defaultStrikeStepE6(refE6: bigint): bigint {
  return refE6 >= 100_000_000n ? 5_000_000n : 1_000_000n;
}

/** Pyth (price, expo) → micro-units, half-up. */
function toE6(price: bigint, expo: number): bigint {
  const shift = expo + 6;
  if (shift >= 0) return price * 10n ** BigInt(shift);
  const d = 10n ** BigInt(-shift);
  return (price + d / 2n) / d;
}

/** Operator-sourced reference prices for one ET day (OPERATOR_STRIKE_PRICES_FILE / env JSON). */
export interface OperatorDayPrices {
  dateKey: string;
  source: string;
  pricesE6: Record<string, string>;
}

export type StrikeReferenceDecision = { ok: true; priceE6: bigint; source: string } | { ok: false; reason: string };

/**
 * Fresh reference price for strike creation (replaces the hardcoded PRIOR_CLOSE_E6 / AAPL ≥ 300 placeholders).
 *   1. Hermes latest for the market feed, ≤ maxAgeSecs old at creation, price > 0, conf ≤ maxConfBps;
 *   2. else an operator price for THIS ET day (dateKey must match) with a non-empty source;
 *   3. else REFUSE — the caller skips that symbol and ALERTs. Never a static/hardcoded fallback.
 * Hermes is currently 403 for equity feeds (DLV-106), so (2) is the working path today.
 */
export function decideStrikeReference(opts: {
  symbol: string;
  dateKey: string;
  nowSec: number;
  feedIdHex?: string;
  maxAgeSecs: number;
  maxConfBps: number;
  hermes?: { parsed: PullPrice } | { error: string };
  /** Sponsored on-chain Pyth PriceUpdateV2 (PYTH_PRICE_FEEDS account; e.g. devnet shard-1), same freshness rule. */
  onchain?: { parsed: PullPrice; account: string } | { error: string };
  operator?: OperatorDayPrices;
}): StrikeReferenceDecision {
  const sym = opts.symbol.toUpperCase();
  const want = (opts.feedIdHex ?? "").replace(/^0x/, "").toLowerCase();
  const fresh = (p: PullPrice, label: string): string | null => {
    const age = opts.nowSec - p.publishTime;
    if (want && p.feedIdHex.replace(/^0x/, "").toLowerCase() !== want) return `${label} feed ${p.feedIdHex} != ${want}`;
    if (age > opts.maxAgeSecs || age < -60) return `${label} price is ${age}s old (> ${opts.maxAgeSecs}s)`;
    if (p.price <= 0n) return `${label} price is non-positive`;
    if ((p.conf * 10_000n) / p.price > BigInt(opts.maxConfBps)) return `${label} conf ratio > ${opts.maxConfBps} bps`;
    return null;
  };
  const whys: string[] = [];
  if (opts.hermes && "parsed" in opts.hermes) {
    const bad = fresh(opts.hermes.parsed, "Hermes");
    const p = opts.hermes.parsed;
    if (!bad) return { ok: true, priceE6: toE6(p.price, p.expo), source: `hermes publish_time=${p.publishTime} (age ${opts.nowSec - p.publishTime}s)` };
    whys.push(bad);
  } else whys.push(opts.hermes ? `Hermes unavailable: ${opts.hermes.error}` : "Hermes not tried");
  if (opts.onchain && "parsed" in opts.onchain) {
    const p = opts.onchain.parsed;
    const bad = fresh(p, `Pyth account ${opts.onchain.account.slice(0, 8)}…`);
    if (!bad) return { ok: true, priceE6: toE6(p.price, p.expo), source: `pyth account ${opts.onchain.account} publish_time=${p.publishTime} (age ${opts.nowSec - p.publishTime}s)` };
    whys.push(bad);
  } else if (opts.onchain) whys.push(`Pyth account unavailable: ${opts.onchain.error}`);
  const why = whys.join("; ");
  const op = opts.operator;
  if (!op) return { ok: false, reason: `${why}; no operator strike prices — set OPERATOR_STRIKE_PRICES_FILE for ${opts.dateKey}` };
  if (op.dateKey !== opts.dateKey) return { ok: false, reason: `${why}; operator strike prices are for ${op.dateKey}, not ${opts.dateKey}` };
  if (!op.source || !op.source.trim()) return { ok: false, reason: `${why}; operator strike prices need a source` };
  const raw = op.pricesE6?.[sym];
  if (raw === undefined) return { ok: false, reason: `${why}; operator strike prices have no ${sym}` };
  if (!/^[1-9][0-9]*$/.test(String(raw))) return { ok: false, reason: `${why}; operator ${sym} price must be a positive integer (micro-USD)` };
  return { ok: true, priceE6: BigInt(raw), source: `operator: ${op.source.trim()}` };
}
