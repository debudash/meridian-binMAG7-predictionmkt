/**
 * DLV-118 (SPEC §1 / §3.3): same-day 0DTE MAG7 markets expire at TODAY's 16:00 America/New_York close.
 * Pure calendar + strike-reference rules shared by the calendar worker, run-staging / devnet-bootstrap
 * (via `ops-cli market-day`) and the localnet today-markets script.
 */
import { expect } from "chai";
import {
  MAG7,
  etWallClockToUnix,
  isTradingDay,
  nextTradingDay,
  sameDaySession,
  atmStrikesE6,
  decideStrikeReference,
} from "../src/marketDay";

const utc = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);

describe("DLV-118 marketDay — same-day 16:00 ET close", () => {
  it("MAG7 is exactly the SPEC §1 list", () => {
    expect(MAG7).to.deep.equal(["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]);
  });

  it("16:00 ET on an EDT day is 20:00 UTC (2026-10-08)", () => {
    expect(etWallClockToUnix("2026-10-08", 16, 0)).to.equal(utc(2026, 10, 8, 20));
    expect(etWallClockToUnix("2026-10-08", 16, 0)).to.equal(1791489600);
    expect(etWallClockToUnix("2026-10-08", 9, 30)).to.equal(utc(2026, 10, 8, 13, 30));
  });

  it("DST end (Sun 2026-11-01): Fri 10-30 close 20:00 UTC, Mon 11-02 close 21:00 UTC", () => {
    expect(etWallClockToUnix("2026-10-30", 16, 0)).to.equal(utc(2026, 10, 30, 20));
    expect(etWallClockToUnix("2026-11-02", 16, 0)).to.equal(utc(2026, 11, 2, 21));
    expect(etWallClockToUnix("2026-11-02", 9, 30)).to.equal(utc(2026, 11, 2, 14, 30));
  });

  it("DST start (Sun 2026-03-08): Fri 03-06 close 21:00 UTC, Mon 03-09 close 20:00 UTC", () => {
    expect(etWallClockToUnix("2026-03-06", 16, 0)).to.equal(utc(2026, 3, 6, 21));
    expect(etWallClockToUnix("2026-03-09", 16, 0)).to.equal(utc(2026, 3, 9, 20));
  });

  it("weekends and NYSE holidays are not trading days; unknown years refuse", () => {
    expect(isTradingDay("2026-10-08")).to.deep.equal({ ok: true });
    expect(isTradingDay("2026-10-10")).to.include({ ok: false, code: "weekend" });
    expect(isTradingDay("2026-10-11")).to.include({ ok: false, code: "weekend" });
    for (const d of ["2026-11-26", "2026-12-25", "2026-07-03", "2026-04-03", "2027-01-01", "2027-03-26", "2027-07-05"]) {
      expect(isTradingDay(d), d).to.include({ ok: false, code: "holiday" });
    }
    expect(isTradingDay("2029-03-01")).to.include({ ok: false, code: "unknown_year" }); // 2028 added in DLV-119
  });

  it("nextTradingDay skips weekends and holidays", () => {
    expect(nextTradingDay("2026-10-09")).to.equal("2026-10-12");
    expect(nextTradingDay("2026-11-25")).to.equal("2026-11-30"); // 11-27 is an early close (DLV-119 M-1)
    expect(nextTradingDay("2026-12-31")).to.equal("2027-01-04");
  });

  describe("sameDaySession(now) → expiry == that ET day's 16:00 close", () => {
    it("mid-session: expiry is today's close, not a later day", () => {
      const now = utc(2026, 10, 8, 18, 36); // 14:36 ET
      const r = sameDaySession(now);
      expect(r.ok).to.equal(true);
      if (!r.ok) return;
      expect(r.plan.dateKey).to.equal("2026-10-08");
      expect(r.plan.closeTs).to.equal(1791489600);
      expect(r.plan.openTs).to.equal(utc(2026, 10, 8, 13, 30));
    });

    it("before the 9:30 open is still the same day's close (localnet / pre-open)", () => {
      const r = sameDaySession(utc(2026, 10, 8, 7)); // 03:00 ET
      expect(r.ok && r.plan.closeTs).to.equal(1791489600);
    });

    it("one second before the close is allowed; at/after the close is REJECTED (never rolls to the next day)", () => {
      expect(sameDaySession(1791489600 - 1).ok).to.equal(true);
      const at = sameDaySession(1791489600);
      expect(at).to.include({ ok: false, code: "after_close" });
      if (!at.ok) expect(at.nextDateKey).to.equal("2026-10-09");
    });

    it("evening ET whose UTC date is already tomorrow is still after TODAY's close (no silent roll)", () => {
      const r = sameDaySession(utc(2026, 10, 9, 1)); // 2026-10-08 21:00 ET
      expect(r).to.include({ ok: false, code: "after_close" });
    });

    it("DST dates: Mon 2026-11-02 at 15:00 EST → 21:00 UTC close; Mon 2026-03-09 at 10:00 EDT → 20:00 UTC close", () => {
      const nov = sameDaySession(utc(2026, 11, 2, 20));
      expect(nov.ok && nov.plan.closeTs).to.equal(utc(2026, 11, 2, 21));
      const mar = sameDaySession(utc(2026, 3, 9, 14));
      expect(mar.ok && mar.plan.closeTs).to.equal(utc(2026, 3, 9, 20));
    });

    it("weekend / holiday rejects unless allowNonTradingDay (localnet override)", () => {
      const sat = utc(2026, 10, 10, 15);
      expect(sameDaySession(sat)).to.include({ ok: false, code: "weekend" });
      const forced = sameDaySession(sat, { allowNonTradingDay: true });
      expect(forced.ok && forced.plan.closeTs).to.equal(utc(2026, 10, 10, 20));
      expect(sameDaySession(utc(2026, 11, 26, 15))).to.include({ ok: false, code: "holiday" });
    });

    it("requireOpen (calendar create window) rejects before 9:30 ET", () => {
      expect(sameDaySession(utc(2026, 10, 8, 13, 29), { requireOpen: true })).to.include({ ok: false, code: "before_open" });
      expect(sameDaySession(utc(2026, 10, 8, 13, 30), { requireOpen: true }).ok).to.equal(true);
    });
  });

  describe("strikes from the prior close (D-026)", () => {
    it("ATM strike rounds to the step, offsets around it", () => {
      expect(atmStrikesE6(227_310_000n, [0], 5_000_000n)).to.deep.equal([225_000_000n]);
      expect(atmStrikesE6(227_600_000n, [-5_000_000, 0, 5_000_000], 5_000_000n)).to.deep.equal([225_000_000n, 230_000_000n, 235_000_000n]);
      expect(atmStrikesE6(42_400_000n, [0], 1_000_000n)).to.deep.equal([42_000_000n]);
      expect(() => atmStrikesE6(2_000_000n, [-5_000_000], 1_000_000n)).to.throw(/> 0/);
    });

    const close = 1791403200; // 2026-10-07 16:00 EDT = the 2026-10-08 market day's prior close
    const prevClose = { dateKey: "2026-10-07", closeTs: close };
    it("a Hermes price at the prior close wins (feed match, publish_time in [close, close + skew], sane conf)", () => {
      const r = decideStrikeReference({
        symbol: "AAPL", dateKey: "2026-10-08", prevClose, feedIdHex: "aa".repeat(32), maxSkewSecs: 300, maxConfBps: 500,
        hermes: { parsed: { feedIdHex: "aa".repeat(32), price: 22731000000n, conf: 1000000n, expo: -8, publishTime: close + 5, prevPublishTime: close - 1 } },
        operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "x", pricesE6: { AAPL: "1" } },
      });
      expect(r).to.deep.include({ ok: true, priceE6: 227_310_000n });
      if (r.ok) expect(r.source).to.match(/^hermes prior close 2026-10-07/);
    });

    it("Hermes 403 (DLV-106) → operator prior close bound to the market day with a source", () => {
      const r = decideStrikeReference({
        symbol: "AAPL", dateKey: "2026-10-08", prevClose, feedIdHex: "aa".repeat(32), maxSkewSecs: 300, maxConfBps: 500,
        hermes: { error: "HTTP 403 not entitled" },
        operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "Nasdaq official close 2026-10-07", pricesE6: { AAPL: "227310000" } },
      });
      expect(r).to.deep.include({ ok: true, priceE6: 227_310_000n });
      if (r.ok) expect(r.source).to.equal("operator: Nasdaq official close 2026-10-07");
    });

    it("refuses a Hermes price not at the prior close, a wrong-day operator file, a missing source or symbol (no hardcoded fallback)", () => {
      const base = { symbol: "AAPL", dateKey: "2026-10-08", prevClose, feedIdHex: "aa".repeat(32), maxSkewSecs: 300, maxConfBps: 500 };
      const late = { parsed: { feedIdHex: "aa".repeat(32), price: 1n, conf: 0n, expo: -8, publishTime: close + 3600, prevPublishTime: 0 } };
      expect(decideStrikeReference({ ...base, hermes: late }).ok).to.equal(false);
      expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: { dateKey: "2026-10-07", closeDateKey: "2026-10-06", source: "s", pricesE6: { AAPL: "1" } } }).ok).to.equal(false);
      expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: " ", pricesE6: { AAPL: "1" } } }).ok).to.equal(false);
      expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "s", pricesE6: { MSFT: "1" } } }).ok).to.equal(false);
      expect(decideStrikeReference({ ...base, hermes: { error: "403" } }).ok).to.equal(false);
    });
  });
});

describe("D-026 strike reference: sponsored on-chain Pyth account (e.g. devnet shard-1) at the prior close", () => {
  const close = 1791403200;
  const base = { symbol: "AAPL", dateKey: "2026-10-08", prevClose: { dateKey: "2026-10-07", closeTs: close }, feedIdHex: "aa".repeat(32), maxSkewSecs: 300, maxConfBps: 500 };
  const px = (publishTime: number) => ({ feedIdHex: "aa".repeat(32), price: 22731000000n, conf: 1000000n, expo: -8, publishTime, prevPublishTime: 0 });
  it("Hermes 403 + on-chain account posted at the prior close → on-chain price (before any operator price)", () => {
    const r = decideStrikeReference({ ...base, hermes: { error: "403" }, onchain: { parsed: px(close + 90), account: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW" },
      operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "op", pricesE6: { AAPL: "1" } } });
    expect(r).to.deep.include({ ok: true, priceE6: 227_310_000n });
    if (r.ok) expect(r.source).to.match(/^pyth account D9uk/);
  });
  it("on-chain account not at the prior close (e.g. this morning's heartbeat) → operator price", () => {
    const r = decideStrikeReference({ ...base, hermes: { error: "403" }, onchain: { parsed: px(close + 15 * 3600), account: "D9uk" },
      operator: { dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "op", pricesE6: { AAPL: "227000000" } } });
    expect(r).to.deep.include({ ok: true, priceE6: 227_000_000n, source: "operator: op" });
  });
});
