/**
 * Operator-entered equity prices (staging, while Hermes lacks equities — Debu-approved 2026-10-08).
 * Pure validation + the Railway call shape for ops/operator-prices.cjs. Unit-tested in
 * apps/automation/test/operator-prices-cli.test.ts. Output JSON = what the worker's loadOperatorDayPrices parses:
 *   {"dateKey":"YYYY-MM-DD","source":"<where the prices came from>","pricesE6":{"AAPL":"227310000",...}}
 * Strike kind (D-026) adds "closeDateKey" = the previous trading day whose official closes these are.
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
 * kind: "strike" = the PREVIOUS trading day's official closes (D-026: strikes are ATM on the prior close), used as the
 *                  strike reference when Hermes / the on-chain feed have no price at that close. Allowed any time from
 *                  that prior close until the market day's CREATE_DEADLINE_ET (default 08:00 ET) — e.g. the evening
 *                  before. The market day = today if it is a session and before the deadline, else the next session.
 *                  Review M2: an explicit dateKey = today is also accepted after the deadline until today's 16:00 ET
 *                  close (the worker keeps retrying until then), with a "LATE: after the 08:00 ET deadline" warning.
 *     | "close"  (set at/after the 16:00 ET close; used by admin_settle when pull settle can't) — market day = today.
 * dateKey (optional) must equal that market day; it must be a full NYSE trading day (no weekend / holiday / early
 * close / unknown year). Throws with every problem listed; returns { varName, json, dateKey, warnings }.
 */
function validateOperatorPrices({ kind, source, prices, nowSec, dateKey, symbols = MAG7, deadlineEt = "08:00" }) {
  if (kind !== "strike" && kind !== "close") throw new Error(`kind must be strike or close (got ${kind})`);
  const errs = [];
  const warnings = [];
  const w = cal.etParts(nowSec);
  const today = w.dateKey;
  const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const dl = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(deadlineEt).trim());
  if (!dl) throw new Error(`CREATE_DEADLINE_ET must be HH:MM (got ${JSON.stringify(deadlineEt)})`);
  const [dlH, dlM] = [Number(dl[1]), Number(dl[2])];
  let market = today;
  let prev = null;
  try {
    if (kind === "strike") {
      const t = cal.tradingDay(today);
      const todayIsSession = t.ok || t.code === "early_close";
      market = todayIsSession && nowSec < cal.etWallToUnix(today, dlH, dlM) ? today : cal.nextSessionDay(today);
      if (market !== today && dateKey === today && t.ok && nowSec < cal.closeTsFor(today)) {
        market = today;
        warnings.push(`LATE: after the ${hhmm(dlH, dlM)} ET deadline — today's (${today}) markets missed the deadline; the worker uses these prices for the missing markets until the 16:00 ET close`);
      }
    }
  } catch (e) {
    errs.push(String(e.message || e));
  }
  if (dateKey !== undefined && dateKey !== market) {
    errs.push(kind === "strike"
      ? `--date ${dateKey} is not the market day ${market} (today's before ${hhmm(dlH, dlM)} ET, else the next session)`
      : `--date ${dateKey} is not today's ET date ${today} (close prices are only for today)`);
  }
  const td = cal.tradingDay(market);
  if (!td.ok) errs.push(`${market}: ${td.reason.replace(/^ALERT /, "")} (${td.code === "early_close" ? "early close" : td.code}) — no 0DTE markets ${market === today ? "today" : "that day"}`);
  if (!source || !String(source).trim()) errs.push(`--source is required (where the prices came from, e.g. "Nasdaq official close${kind === "strike" ? " <previous trading day>" : ""}")`);
  const got = Object.keys(prices || {});
  for (const s of symbols) if (!got.includes(s)) errs.push(`missing ${s} (all of ${symbols.join(",")} are required)`);
  for (const s of got) if (!symbols.includes(s)) errs.push(`unexpected ticker ${s} (only ${symbols.join(",")})`);
  if (td.ok && kind === "strike") {
    try {
      prev = cal.prevTradingDay(market);
      const prevClose = cal.sessionCloseTsFor(prev);
      if (nowSec < prevClose) {
        const c = cal.etParts(prevClose);
        errs.push(market !== today && cal.tradingDay(today).ok
          ? `it is past today's ${hhmm(dlH, dlM)} ET create deadline; the next strike prices are for ${market} = the ${prev} official close — set them after ${hhmm(c.hour, c.minute)} ET`
          : `the ${prev} close (${hhmm(c.hour, c.minute)} ET) has not happened yet — strike prices are the previous trading day's official closes`);
      }
    } catch (e) {
      errs.push(String(e.message || e));
    }
  } else if (td.ok) {
    const closeTs = cal.closeTsFor(today);
    if (nowSec < closeTs) errs.push(`close prices before today's 16:00 ET close are refused (it is ${hhmm(w.hour, w.minute)} ET)`);
  }
  if (errs.length) throw new Error(`refused:\n  - ${errs.join("\n  - ")}`);
  const pricesE6 = {};
  for (const s of symbols) pricesE6[s] = prices[s];
  const body = kind === "strike"
    ? { dateKey: market, closeDateKey: prev, source: String(source).trim(), pricesE6 }
    : { dateKey: market, source: String(source).trim(), pricesE6 };
  return {
    varName: kind === "strike" ? "OPERATOR_STRIKE_PRICES" : "OPERATOR_CLOSE_PRICES",
    json: JSON.stringify(body),
    dateKey: market,
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
