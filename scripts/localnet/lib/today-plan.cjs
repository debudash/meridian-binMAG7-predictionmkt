/**
 * DLV-118 — pure plan for scripts/localnet/today-markets.cjs (unit-tested in
 * apps/automation/test/localnet-today-plan.test.ts). No RPC, no keys.
 *
 * `md` is apps/automation's marketDay module (dist/marketDay.js at runtime, src/marketDay.ts in tests),
 * so the localnet expiry rule is byte-for-byte the calendar worker's rule.
 */
"use strict";

/** Localnet mock reference prices (USD) — same levels the :8899 play bootstrap seeded its mock Pyth with. */
const LOCALNET_REF_USD = { AAPL: 225, MSFT: 415, GOOGL: 162, AMZN: 186, NVDA: 138, META: 572, TSLA: 248 };

/** "AAPL=227.31,MSFT=415" → { AAPL: 227310000n, ... } (micro-USD). */
function parseRefPrices(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]{1,8})=([0-9]+(?:\.[0-9]{1,6})?)$/.exec(part);
    if (!m) throw new Error(`bad REF_PRICES entry "${part}" (want SYMBOL=123.45)`);
    const [whole, frac = ""] = m[2].split(".");
    out[m[1].toUpperCase()] = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  }
  return out;
}

/** Seed fair Yes price for the maker ladder: 0.5 at the money, ±4×moneyness, clamped 0.25–0.75 (seed-phoenix rule). */
function fairYes(refE6, strikeE6) {
  const v = 0.5 + ((Number(refE6) - Number(strikeE6)) / Number(strikeE6)) * 4;
  return Math.min(0.75, Math.max(0.25, Math.round(v * 100) / 100));
}

/**
 * Plan today's-close markets for `symbols` at effective time `nowSec`.
 * Returns { ok:false, code, reason } when there is no same-day session (after the 16:00 ET close → never rolls).
 */
function planTodayMarkets(md, { nowSec, symbols, refPricesE6 = {}, allowNonTradingDay = false }) {
  const s = md.sameDaySession(nowSec, { allowNonTradingDay });
  if (!s.ok) return { ok: false, code: s.code, reason: s.reason, dateKey: s.dateKey, nextDateKey: s.nextDateKey };
  const markets = [];
  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    if (!md.MAG7.includes(symbol)) throw new Error(`${symbol} is not in the SPEC §1 MAG7 list`);
    const refE6 = refPricesE6[symbol] ?? (LOCALNET_REF_USD[symbol] !== undefined ? BigInt(LOCALNET_REF_USD[symbol]) * 1_000_000n : undefined);
    if (refE6 === undefined) throw new Error(`no reference price for ${symbol}`);
    const [strikeE6] = md.atmStrikesE6(refE6, [0], md.defaultStrikeStepE6(refE6));
    markets.push({ symbol, refE6, strikeE6, expiryTs: s.plan.closeTs, mockPriceE8: refE6 * 100n, fairYes: fairYes(refE6, strikeE6) });
  }
  return { ok: true, session: s.plan, markets };
}

module.exports = { LOCALNET_REF_USD, parseRefPrices, fairYes, planTodayMarkets };
