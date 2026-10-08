/**
 * DLV-118 (SPEC §1 / §3.3): devnet-bootstrap markets come from TODAY's plan, never a fixed next-close date.
 * `today` = JSON from `ops-cli market-day --strikes` (run-staging.sh writes it to $TODAY_PLAN):
 *   { ok, dateKey, openTs, closeTs (= 16:00 ET today), markets:[{symbol, strikeE6, refE6, source}], refused:[…] }
 * Pure; unit-tested in apps/automation/test/ops-today-plan.test.ts.
 */
"use strict";

function bootstrapPlanFromToday(today, { nbooks, feeds, nowSec }) {
  if (!today || today.ok !== true) {
    const why = today ? `${today.code}: ${today.reason}` : "TODAY_PLAN missing";
    throw new Error(`no same-day session (${why}) — no markets created; rerun on the next trading day (never next-close books)`);
  }
  if (!Number.isInteger(today.closeTs)) throw new Error("TODAY_PLAN.closeTs missing");
  if (nowSec >= today.closeTs) throw new Error(`TODAY_PLAN ${today.dateKey} close ${today.closeTs} has passed — refusing (same-day only)`);
  const markets = (today.markets || []).filter((m) => feeds[m.symbol]);
  if (!markets.length) throw new Error(`TODAY_PLAN ${today.dateKey} has no market with a fresh strike reference (see refused[]) — set OPERATOR_STRIKE_PRICES_FILE`);
  const regular = markets.map((m, i) => ({
    symbol: m.symbol,
    strike: Number(m.strikeE6) / 1e6,
    strikeE6: String(m.strikeE6),
    refE6: String(m.refE6),
    refSource: m.source,
    expiry: today.closeTs,
    book: i < nbooks,
    fair: 0.5,
  }));
  // 20-min settle-test market: ATM strike from the same fresh reference (AAPL if present) — no more hardcoded AAPL ≥ 300.
  const s = markets.find((m) => m.symbol === "AAPL") || markets[0];
  return { dateKey: today.dateKey, closeTs: today.closeTs, regular, short: { symbol: s.symbol, strike: Number(s.strikeE6) / 1e6 } };
}

module.exports = { bootstrapPlanFromToday };
