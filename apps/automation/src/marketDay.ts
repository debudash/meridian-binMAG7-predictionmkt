/**
 * DLV-118 (SPEC §1 / §3.3): same-day 0DTE MAG7 markets expire at TODAY's 16:00 America/New_York close.
 *
 * Pure helpers (no RPC), shared by:
 *   - the calendar worker (D-026: create from CREATE_FROM_ET 07:00, done by CREATE_DEADLINE_ET 08:00 → expiry = that
 *     day's 16:00 ET close; strikes ATM on the previous trading day's close),
 *   - ops/run-staging.sh + ops/devnet-bootstrap.cjs via `ops-cli market-day` (no more fixed next-close books),
 *   - scripts/localnet/today-markets.cjs (effective clock = SimClock when enabled, else chain time).
 *
 * Rules:
 *   - expiry = 16:00:00 America/New_York on the ET calendar day of `now` (DST via Intl, never a fixed offset);
 *   - at/after that close → REJECT (`after_close`), never roll to the next day silently (SPEC: same-day only);
 *     the next trading day's run creates that day's markets;
 *   - weekends / NYSE full-day holidays → REJECT unless `allowNonTradingDay` (localnet override only);
 *   - a year missing from the holiday table → REJECT (`unknown_year`) so ops notices before a wrong expiry ships;
 *   - NYSE early-close days (13:00 ET, NYSE_EARLY_CLOSES) → REJECT (`early_close`) with an ALERT (DLV-119 / Reviewers
 *     M-1): a 16:00 expiry would leave books trading ~3 h past the real close with no regular-session price. Proper
 *     13:00 handling (closeTs = 13:00, per-market settle gate) is deferred to mainnet (TRACKER Todo).
 */
import type { PullPrice } from "./pyth/pullOracle";

export const ET_TZ = "America/New_York";
/** SPEC §1 MAG7 list (order as written there). */
export const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;
export const OPEN_HOUR_ET = 9;
export const OPEN_MINUTE_ET = 30;
export const CLOSE_HOUR_ET = 16;
/** NYSE early-close days close at 13:00 ET (used for the prior-close strike reference only, D-026). */
export const EARLY_CLOSE_HOUR_ET = 13;

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
  // 2028 (nyse.com): no New Year's Day holiday (Jan 1 is a Saturday).
  "2028-01-17": "Martin Luther King Jr. Day",
  "2028-02-21": "Washington's Birthday",
  "2028-04-14": "Good Friday",
  "2028-05-29": "Memorial Day",
  "2028-06-19": "Juneteenth",
  "2028-07-04": "Independence Day",
  "2028-09-04": "Labor Day",
  "2028-11-23": "Thanksgiving Day",
  "2028-12-25": "Christmas Day",
};
/** NYSE 13:00 ET early closes (nyse.com footnotes). Refused for 0DTE creation until 13:00 handling ships (M-1). */
export const NYSE_EARLY_CLOSES: Record<string, string> = {
  "2026-11-27": "day after Thanksgiving (13:00 ET close)",
  "2026-12-24": "Christmas Eve (13:00 ET close)",
  "2027-11-26": "day after Thanksgiving (13:00 ET close)",
  "2028-07-03": "day before Independence Day (13:00 ET close)",
  "2028-11-24": "day after Thanksgiving (13:00 ET close)",
};
export const CALENDAR_YEARS = new Set([2026, 2027, 2028]);

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

export type NonTradingCode = "weekend" | "holiday" | "unknown_year" | "early_close";
export type TradingDayCheck = { ok: true } | { ok: false; code: NonTradingCode; reason: string };

export function isTradingDay(dateKey: string): TradingDayCheck {
  const [y, mo, d] = parseDateKey(dateKey);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return { ok: false, code: "weekend", reason: `${dateKey} is a ${wd === 0 ? "Sunday" : "Saturday"} (no NYSE session)` };
  if (!CALENDAR_YEARS.has(y)) return { ok: false, code: "unknown_year", reason: `NYSE holiday table has no ${y}; extend NYSE_HOLIDAYS in apps/automation/src/marketDay.ts` };
  const h = NYSE_HOLIDAYS[dateKey];
  if (h) return { ok: false, code: "holiday", reason: `${dateKey} is an NYSE holiday (${h})` };
  const e = NYSE_EARLY_CLOSES[dateKey];
  if (e) return { ok: false, code: "early_close", reason: `ALERT ${dateKey} is an NYSE early-close day (${e}); 0DTE creation refused until 13:00 handling ships (M-1)` };
  return { ok: true };
}

/** Codes that page ops (logged with ALERT): calendar gaps and early closes. Weekends / holidays / after-close are routine. */
export function isAlertCode(code: string): boolean {
  return code === "early_close" || code === "unknown_year";
}

/** Nit (Reviewers !91): ALERT ≥ 30 days before the holiday table runs out, so a year is added before creation stops. */
export function calendarHorizonAlert(nowSec: number, days = 30): string | null {
  const y = Number(etWall(nowSec + days * 86400).dateKey.slice(0, 4));
  return CALENDAR_YEARS.has(y)
    ? null
    : `ALERT NYSE holiday table has no ${y} and it is ≤ ${days} days away; add it to NYSE_HOLIDAYS / NYSE_EARLY_CLOSES (apps/automation/src/marketDay.ts + ops/lib/nyse-calendar.cjs)`;
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

/**
 * D-026: previous NYSE session strictly before `dateKey` (the day whose close is the strike reference). Weekends and
 * full-day holidays are skipped; an early-close day IS a session (it closed at 13:00 ET); an unknown year throws.
 */
export function prevTradingDay(dateKey: string): string {
  let k = addDays(dateKey, -1);
  for (let i = 0; i < 14; i++, k = addDays(k, -1)) {
    const t = isTradingDay(k);
    if (t.ok || t.code === "early_close") return k;
    if (t.code === "unknown_year") throw new Error(t.reason);
  }
  throw new Error(`no trading day within 14 days before ${dateKey}`);
}

/**
 * D-026: the prior session's close for market day `dateKey` = the strike reference time. 16:00 ET, or 13:00 ET when
 * the previous session was an NYSE early close (NYSE_EARLY_CLOSES). Throws on an unknown year (via prevTradingDay).
 */
export function priorSessionClose(dateKey: string): { dateKey: string; closeTs: number; earlyClose: boolean } {
  const prev = prevTradingDay(dateKey);
  const earlyClose = prev in NYSE_EARLY_CLOSES;
  return { dateKey: prev, closeTs: etWallClockToUnix(prev, earlyClose ? EARLY_CLOSE_HOUR_ET : CLOSE_HOUR_ET, 0), earlyClose };
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
  | { ok: false; code: NonTradingCode | "after_close" | "before_open" | "before_create_window"; reason: string; dateKey: string; nextDateKey?: string };

/**
 * The same-day session for `nowSec` (effective clock: SimClock when enabled on localnet, else chain/wall time).
 * Expiry is always that ET day's 16:00 close; after the close this REJECTS (no roll-over).
 * `notBeforeEt` (D-026, the calendar worker's CREATE_FROM_ET) rejects earlier ET wall times with `before_create_window`;
 * `requireOpen` (09:30 ET) is kept for other callers.
 */
export function sameDaySession(
  nowSec: number,
  opts: { allowNonTradingDay?: boolean; requireOpen?: boolean; notBeforeEt?: { hour: number; minute: number } } = {},
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
  if (opts.notBeforeEt && nowSec < etWallClockToUnix(dateKey, opts.notBeforeEt.hour, opts.notBeforeEt.minute)) {
    const hhmm = `${String(opts.notBeforeEt.hour).padStart(2, "0")}:${String(opts.notBeforeEt.minute).padStart(2, "0")}`;
    return { ok: false, code: "before_create_window", reason: `before the ${dateKey} ${hhmm} ET create window`, dateKey };
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

/**
 * Operator-sourced prices for one ET market day (OPERATOR_STRIKE_PRICES(_FILE) / OPERATOR_CLOSE_PRICES(_FILE) JSON).
 * Strike kind (D-026): `dateKey` = the MARKET day, prices = the previous trading day's official closes; `closeDateKey`
 * names that previous day and is REQUIRED for strikes (a YYYY-MM-DD string equal to prevTradingDay(dateKey); review L3).
 * Kept as the raw JSON value so a wrong type is refused with a reason, not silently dropped. Unused for closes.
 */
export interface OperatorDayPrices {
  dateKey: string;
  closeDateKey?: unknown;
  source: string;
  pricesE6: Record<string, string>;
}

export type StrikeReferenceDecision = { ok: true; priceE6: bigint; source: string } | { ok: false; reason: string };

/**
 * D-026: strike reference = the PREVIOUS trading day's close (`prevClose` = priorSessionClose(dateKey); 13:00 ET after
 * an early close). Order:
 *   1. Hermes price AT the prior close (/v2/updates/price/{closeTs}: first update with publish_time >= closeTs), accepted
 *      iff feed matches, closeTs <= publish_time <= closeTs + maxSkewSecs, price > 0, conf <= maxConfBps;
 *   2. else the sponsored on-chain PriceUpdateV2, same window (usually not posted at the close — fine);
 *   3. else an operator prior close for THIS market day (dateKey must match; closeDateKey must be the prior day)
 *      with a non-empty source, within ±operatorBandBps of the last known Pyth price;
 *   4. else REFUSE — the caller skips that symbol and ALERTs. Never a static/hardcoded fallback.
 * Hermes is currently 403 for equity feeds (DLV-106), so (3) is the working path today.
 */
export function decideStrikeReference(opts: {
  symbol: string;
  /** Market day (ET) the strikes are for. */
  dateKey: string;
  prevClose: { dateKey: string; closeTs: number };
  feedIdHex?: string;
  maxSkewSecs: number;
  maxConfBps: number;
  hermes?: { parsed: PullPrice } | { error: string };
  /** Sponsored on-chain Pyth PriceUpdateV2 (PYTH_PRICE_FEEDS account; e.g. devnet shard-1), same prior-close rule. */
  onchain?: { parsed: PullPrice; account: string } | { error: string };
  operator?: OperatorDayPrices;
  /** Operator sanity band vs the last known Pyth price (default 2000 bps = ±20%). */
  operatorBandBps?: number;
}): StrikeReferenceDecision {
  const sym = opts.symbol.toUpperCase();
  const want = (opts.feedIdHex ?? "").replace(/^0x/, "").toLowerCase();
  const { dateKey: prevKey, closeTs } = opts.prevClose;
  const atClose = (p: PullPrice, label: string): string | null => {
    const skew = p.publishTime - closeTs;
    if (want && p.feedIdHex.replace(/^0x/, "").toLowerCase() !== want) return `${label} feed ${p.feedIdHex} != ${want}`;
    if (skew < 0) return `${label} publish_time ${p.publishTime} is before the ${prevKey} close ${closeTs}`;
    if (skew > opts.maxSkewSecs) return `${label} publish_time is ${skew}s after the ${prevKey} close (> ${opts.maxSkewSecs}s skew)`;
    if (p.price <= 0n) return `${label} price is non-positive`;
    if ((p.conf * 10_000n) / p.price > BigInt(opts.maxConfBps)) return `${label} conf ratio > ${opts.maxConfBps} bps`;
    return null;
  };
  const whys: string[] = [];
  // Last known Pyth price (any time) = sanity anchor for operator prices (Reviewers nit: ±OPERATOR_BAND_BPS).
  let anchorE6: bigint | null = null;
  for (const c of [opts.hermes, opts.onchain]) {
    if (c && "parsed" in c && c.parsed.price > 0n && (!want || c.parsed.feedIdHex.replace(/^0x/, "").toLowerCase() === want)) {
      anchorE6 = toE6(c.parsed.price, c.parsed.expo);
      break;
    }
  }
  if (opts.hermes && "parsed" in opts.hermes) {
    const p = opts.hermes.parsed;
    const bad = atClose(p, "Hermes");
    if (!bad) return { ok: true, priceE6: toE6(p.price, p.expo), source: `hermes prior close ${prevKey} publish_time=${p.publishTime} (+${p.publishTime - closeTs}s)` };
    whys.push(bad);
  } else whys.push(opts.hermes ? `Hermes unavailable: ${opts.hermes.error}` : "Hermes not tried");
  if (opts.onchain && "parsed" in opts.onchain) {
    const p = opts.onchain.parsed;
    const bad = atClose(p, `Pyth account ${opts.onchain.account.slice(0, 8)}…`);
    if (!bad) return { ok: true, priceE6: toE6(p.price, p.expo), source: `pyth account ${opts.onchain.account} prior close ${prevKey} publish_time=${p.publishTime} (+${p.publishTime - closeTs}s)` };
    whys.push(bad);
  } else if (opts.onchain) whys.push(`Pyth account unavailable: ${opts.onchain.error}`);
  const why = whys.join("; ");
  const op = opts.operator;
  if (!op) return { ok: false, reason: `${why}; no operator prior closes — set OPERATOR_STRIKE_PRICES(_FILE) {dateKey:"${opts.dateKey}", closeDateKey:"${prevKey}", …}` };
  if (op.dateKey !== opts.dateKey) return { ok: false, reason: `${why}; operator strike prices are for market day ${op.dateKey}, not ${opts.dateKey}` };
  if (typeof op.closeDateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(op.closeDateKey)) {
    const got = op.closeDateKey === undefined ? "none" : JSON.stringify(op.closeDateKey);
    return { ok: false, reason: `${why}; operator strike prices need closeDateKey = "${prevKey}" (the previous trading day, YYYY-MM-DD string; got ${got})` };
  }
  if (op.closeDateKey !== prevKey) {
    return { ok: false, reason: `${why}; operator closeDateKey ${op.closeDateKey} is not the previous trading day ${prevKey} of ${opts.dateKey}` };
  }
  if (!op.source || !op.source.trim()) return { ok: false, reason: `${why}; operator strike prices need a source` };
  const raw = op.pricesE6?.[sym];
  if (raw === undefined) return { ok: false, reason: `${why}; operator strike prices have no ${sym}` };
  if (!/^[1-9][0-9]*$/.test(String(raw))) return { ok: false, reason: `${why}; operator ${sym} price must be a positive integer (micro-USD)` };
  const priceE6 = BigInt(raw);
  const bandBps = BigInt(opts.operatorBandBps ?? 2000);
  if (anchorE6 !== null) {
    const diff = priceE6 > anchorE6 ? priceE6 - anchorE6 : anchorE6 - priceE6;
    if (diff * 10_000n > anchorE6 * bandBps) {
      return { ok: false, reason: `${why}; operator ${sym} ${priceE6} is outside the ±${Number(bandBps) / 100}% band of the last Pyth price ${anchorE6} — check the operator price` };
    }
  }
  return { ok: true, priceE6, source: `operator: ${op.source.trim()}` };
}
