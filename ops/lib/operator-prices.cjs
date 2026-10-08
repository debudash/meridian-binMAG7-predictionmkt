/**
 * Operator-entered equity prices (staging, while Hermes lacks equities — Debu-approved 2026-10-08).
 * Pure validation + the Railway call shape for ops/operator-prices.cjs. Unit-tested in
 * apps/automation/test/operator-prices-cli.test.ts. Output JSON = what the worker's loadOperatorDayPrices parses:
 *   {"dateKey":"YYYY-MM-DD","source":"<where the prices came from>","pricesE6":{"AAPL":"227310000",...}}
 */
"use strict";
const cal = require("./nyse-calendar.cjs");

const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const MAX_PRICE_E6 = 100000n * 1000000n; // $100k sanity ceiling

function toE6(s) {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`price "${s}" must be a positive decimal with at most 6 decimals (USD)`);
  const v = BigInt(m[1]) * 1000000n + BigInt((m[2] || "").padEnd(6, "0") || "0");
  if (v <= 0n) throw new Error(`price "${s}" must be > 0`);
  if (v > MAX_PRICE_E6) throw new Error(`price "${s}" is above the $100,000 sanity ceiling`);
  return v.toString();
}

/** ["AAPL=227.31", …] → { AAPL: "227310000", … } (symbols upper-cased; duplicates refused). */
function parsePriceArgs(pairs) {
  const out = {};
  for (const p of pairs) {
    const i = String(p).indexOf("=");
    if (i <= 0) throw new Error(`"${p}": want SYMBOL=price`);
    const sym = p.slice(0, i).trim().toUpperCase();
    if (!/^[A-Z.]{1,8}$/.test(sym)) throw new Error(`"${p}": bad symbol`);
    if (sym in out) throw new Error(`${sym} given twice`);
    out[sym] = toE6(p.slice(i + 1));
  }
  return out;
}

/**
 * kind: "strike" (set before the 09:30 ET open; used as the strike reference when Hermes / the on-chain feed can't)
 *     | "close"  (set at/after the 16:00 ET close; used by admin_settle when pull settle can't).
 * dateKey (optional) must equal TODAY's ET date; the day must be a full NYSE trading day (no weekend / holiday /
 * early close / unknown year). Throws with every problem listed; returns { varName, json, dateKey, warnings }.
 */
function validateOperatorPrices({ kind, source, prices, nowSec, dateKey, symbols = MAG7 }) {
  if (kind !== "strike" && kind !== "close") throw new Error(`kind must be strike or close (got ${kind})`);
  const errs = [];
  const warnings = [];
  const today = cal.etParts(nowSec).dateKey;
  if (dateKey !== undefined && dateKey !== today) errs.push(`--date ${dateKey} is not today's ET date ${today} (prices are only for today)`);
  const td = cal.tradingDay(today);
  if (!td.ok) errs.push(`${today}: ${td.reason.replace(/^ALERT /, "")} (${td.code === "early_close" ? "early close" : td.code}) — no 0DTE markets today`);
  if (!source || !String(source).trim()) errs.push("--source is required (where the prices came from, e.g. \"Nasdaq last sale 09:25 ET\")");
  const got = Object.keys(prices || {});
  for (const s of symbols) if (!got.includes(s)) errs.push(`missing ${s} (all of ${symbols.join(",")} are required)`);
  for (const s of got) if (!symbols.includes(s)) errs.push(`unexpected ticker ${s} (only ${symbols.join(",")})`);
  if (td.ok) {
    const closeTs = cal.closeTsFor(today);
    const w = cal.etParts(nowSec);
    if (kind === "strike") {
      if (nowSec >= closeTs) errs.push(`strike prices after today's 16:00 ET close are useless (same-day markets only)`);
      else if (w.hour > 9 || (w.hour === 9 && w.minute >= 30)) warnings.push(`late: it is past the 09:30 ET open — the worker creates on its next start (this set triggers a redeploy)`);
    } else if (nowSec < closeTs) errs.push(`close prices before today's 16:00 ET close are refused (it is ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")} ET)`);
  }
  if (errs.length) throw new Error(`refused:\n  - ${errs.join("\n  - ")}`);
  const pricesE6 = {};
  for (const s of symbols) pricesE6[s] = prices[s];
  return {
    varName: kind === "strike" ? "OPERATOR_STRIKE_PRICES" : "OPERATOR_CLOSE_PRICES",
    json: JSON.stringify({ dateKey: today, source: String(source).trim(), pricesE6 }),
    dateKey: today,
    warnings,
  };
}

/** Child env for the railway CLI: the meridian-staging PROJECT token only; the account-wide token is removed. */
function railwayEnv(env) {
  if (!env.RAILWAY_PROJECT_TOKEN) throw new Error("RAILWAY_PROJECT_TOKEN is not set (meridian-staging project token)");
  const out = { ...env, RAILWAY_TOKEN: env.RAILWAY_PROJECT_TOKEN };
  delete out.RAILWAY_API_TOKEN;
  return out;
}

/**
 * railway args — a value goes on stdin, never argv (so it is not in `ps`). `clear` empties the variable with
 * `NAME=` on argv (Railway refuses an empty stdin value; an empty value has nothing to hide).
 */
function railwayArgs(varName, { skipDeploys, clear = false }) {
  return ["variable", "set", clear ? `${varName}=` : varName, ...(clear ? [] : ["--stdin"]), "--service", "automation", ...(skipDeploys ? ["--skip-deploys"] : [])];
}

/** The worker reads OPERATOR_* at start: restart it explicitly (a set that doesn't change the value deploys nothing). */
function railwayRedeployArgs() {
  return ["redeploy", "--service", "automation", "--yes"];
}

module.exports = { MAG7, parsePriceArgs, validateOperatorPrices, railwayEnv, railwayArgs, railwayRedeployArgs };
