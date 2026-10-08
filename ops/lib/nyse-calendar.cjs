/**
 * NYSE calendar for box ops scripts (plain CJS, no build). MUST equal apps/automation/src/marketDay.ts
 * NYSE_HOLIDAYS / NYSE_EARLY_CLOSES (asserted by apps/automation/test/dlv119-review.test.ts) and its prevTradingDay /
 * prior-close rule (d026-create-0800.test.ts). Source: nyse.com.
 */
"use strict";
const NYSE_HOLIDAYS = {
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
  "2028-01-17": "Martin Luther King Jr. Day",
  "2028-02-21": "Washington's Birthday",
  "2028-04-14": "Good Friday",
  "2028-05-29": "Memorial Day",
  "2028-06-19": "Juneteenth",
  "2028-07-04": "Independence Day",
  "2028-09-04": "Labor Day",
  "2028-11-23": "Thanksgiving Day",
  "2028-12-25": "Christmas Day"
};
const NYSE_EARLY_CLOSES = {
  "2026-11-27": "day after Thanksgiving (13:00 ET close)",
  "2026-12-24": "Christmas Eve (13:00 ET close)",
  "2027-11-26": "day after Thanksgiving (13:00 ET close)",
  "2028-07-03": "day before Independence Day (13:00 ET close)",
  "2028-11-24": "day after Thanksgiving (13:00 ET close)"
};
const CALENDAR_YEARS = new Set([2026,2027,2028]);

/** ET wall parts for unix seconds (DST via Intl). */
function etParts(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: p.weekday };
}

/** { ok:true } | { ok:false, code: weekend|unknown_year|holiday|early_close, reason } — same rules as marketDay.isTradingDay. */
function tradingDay(dateKey) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) return { ok: false, code: "weekend", reason: `${dateKey} is a weekend` };
  if (!CALENDAR_YEARS.has(y)) return { ok: false, code: "unknown_year", reason: `NYSE holiday table has no ${y}` };
  if (NYSE_HOLIDAYS[dateKey]) return { ok: false, code: "holiday", reason: `${dateKey} is an NYSE holiday (${NYSE_HOLIDAYS[dateKey]})` };
  if (NYSE_EARLY_CLOSES[dateKey]) return { ok: false, code: "early_close", reason: `ALERT ${dateKey} is an NYSE early-close day (${NYSE_EARLY_CLOSES[dateKey]})` };
  return { ok: true };
}

/** Unix seconds of hour:minute ET on dateKey (DST via Intl). */
function etWallToUnix(dateKey, hour, minute = 0) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  for (const off of [4, 5]) {
    const t = Date.UTC(y, mo - 1, d, hour + off, minute) / 1000;
    const q = etParts(t);
    if (q.dateKey === dateKey && q.hour === hour && q.minute === minute) return t;
  }
  throw new Error(`no ${hour}:${String(minute).padStart(2, "0")} ET on ${dateKey}`);
}

/** Unix seconds of 16:00 ET on dateKey. */
function closeTsFor(dateKey) {
  return etWallToUnix(dateKey, 16, 0);
}

/** D-026: a day's actual session close — 13:00 ET on an NYSE early close, else 16:00 ET (prior-close reference only). */
function sessionCloseTsFor(dateKey) {
  return etWallToUnix(dateKey, NYSE_EARLY_CLOSES[dateKey] ? 13 : 16, 0);
}

function addDays(dateKey, n) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** First/last NYSE session (early closes count) strictly after (dir=1) / before (dir=-1) dateKey; unknown year throws. */
function stepSession(dateKey, dir) {
  let k = addDays(dateKey, dir);
  for (let i = 0; i < 14; i++, k = addDays(k, dir)) {
    const t = tradingDay(k);
    if (t.ok || t.code === "early_close") return k;
    if (t.code === "unknown_year") throw new Error(t.reason);
  }
  throw new Error(`no NYSE session within 14 days of ${dateKey}`);
}

/** D-026: previous NYSE session before dateKey — same rule as marketDay.prevTradingDay (early closes count). */
function prevTradingDay(dateKey) {
  return stepSession(dateKey, -1);
}

/** Next NYSE session after dateKey, early closes included (callers refuse an early-close market day themselves). */
function nextSessionDay(dateKey) {
  return stepSession(dateKey, 1);
}

module.exports = { NYSE_HOLIDAYS, NYSE_EARLY_CLOSES, CALENDAR_YEARS, etParts, tradingDay, closeTsFor, sessionCloseTsFor, etWallToUnix, prevTradingDay, nextSessionDay };
