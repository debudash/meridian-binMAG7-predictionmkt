/**
 * D-026 (Debu 2026-10-08, Peak6 PRD "market creation by 8:00 AM ET"): the calendar worker creates each trading day's
 * markets in [CREATE_FROM_ET (07:00), 16:00) ET, ALERTs once a day if they are not all created by CREATE_DEADLINE_ET
 * (08:00), and strikes are ATM on the PREVIOUS NYSE trading day's close (13:00 ET when that day was an early close):
 * Hermes price at the prior close → sponsored on-chain PriceUpdateV2 at the prior close → operator prior closes → refuse.
 */
import * as path from "path";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "../src/config";
import { decideStrikeReference, prevTradingDay, priorSessionClose, sameDaySession } from "../src/marketDay";
import { createCalendarState, planDayForOps, runMorningCreate, strikeReferenceFor } from "../src/modes/calendar";
import { PullPrice, PYTH_RECEIVER_PROGRAM_ID } from "../src/pyth/pullOracle";

const REPO = path.resolve(__dirname, "../../..");
const utc = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const FEED_HEX = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const CLOSE_1007 = 1791403200; // 2026-10-07 16:00 EDT = the prior close for the 2026-10-08 market day
const CLOSE_1008 = 1791489600;

function devnetCfg(extra: Record<string, string> = {}, symbols = ["AAPL", "MSFT"]) {
  const feeds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const s of symbols) {
    feeds[s] = Keypair.generate().publicKey.toBase58();
    ids[s] = FEED_HEX;
  }
  return loadConfig({
    SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x", COLLATERAL_MINT: Keypair.generate().publicKey.toBase58(),
    STRIKE_SYMBOLS: symbols.join(","), STRIKE_OFFSETS_E6: "0", PYTH_PRICE_FEEDS: JSON.stringify(feeds), PYTH_FEED_IDS: JSON.stringify(ids), ...extra,
  } as any);
}
const op = (dateKey: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ dateKey, source: "Nasdaq official close 2026-10-07", pricesE6: { AAPL: "227310000", MSFT: "414200000" }, ...extra });
const px = (publishTime: number, o: Partial<PullPrice> = {}): PullPrice =>
  ({ feedIdHex: FEED_HEX, price: 22731000000n, conf: 1000000n, expo: -8, publishTime, prevPublishTime: publishTime - 1, ...o });

function captureLogs<T>(fn: () => Promise<T>): Promise<{ out: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  return fn().then((out) => { console.log = orig; return { out, logs }; }, (e) => { console.log = orig; throw e; });
}

describe("D-026 prevTradingDay / priorSessionClose", () => {
  it("Mon → Fri; skips NYSE holidays", () => {
    expect(prevTradingDay("2026-10-12")).to.equal("2026-10-09");
    expect(prevTradingDay("2026-10-08")).to.equal("2026-10-07");
    expect(prevTradingDay("2026-09-08")).to.equal("2026-09-04"); // Labor Day 09-07
    expect(prevTradingDay("2026-11-27")).to.equal("2026-11-25"); // Thanksgiving 11-26
  });

  it("an early-close day IS a previous session; its reference close is 13:00 ET, not 16:00", () => {
    expect(prevTradingDay("2026-11-30")).to.equal("2026-11-27");
    expect(priorSessionClose("2026-11-30")).to.deep.equal({ dateKey: "2026-11-27", closeTs: sec(utc(2026, 11, 27, 18)), earlyClose: true });
    expect(prevTradingDay("2026-12-28")).to.equal("2026-12-24"); // 12-25 holiday, 12-24 early close
    expect(priorSessionClose("2026-12-28").closeTs).to.equal(sec(utc(2026, 12, 24, 18)));
    expect(priorSessionClose("2026-10-08")).to.deep.equal({ dateKey: "2026-10-07", closeTs: CLOSE_1007, earlyClose: false });
  });

  it("unknown years refuse (throw) instead of guessing", () => {
    expect(() => prevTradingDay("2026-01-02")).to.throw(/2025/); // 01-01 holiday → 2025 not in the table
    expect(() => prevTradingDay("2029-01-03")).to.throw(/2029/);
  });

  it("ops/lib/nyse-calendar.cjs prevTradingDay / sessionCloseTsFor match marketDay", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cal = require(path.join(REPO, "ops/lib/nyse-calendar.cjs"));
    for (const d of ["2026-10-12", "2026-10-08", "2026-09-08", "2026-11-27", "2026-11-30", "2026-12-28", "2027-01-04", "2028-07-05"]) {
      expect(cal.prevTradingDay(d), d).to.equal(prevTradingDay(d));
      expect(cal.sessionCloseTsFor(cal.prevTradingDay(d)), d).to.equal(priorSessionClose(d).closeTs);
    }
    expect(() => cal.prevTradingDay("2026-01-02")).to.throw(/2025/);
  });
});

describe("D-026 create window [07:00, 16:00) ET + 08:00 deadline", () => {
  it("sameDaySession notBeforeEt → before_create_window", () => {
    const w = { notBeforeEt: { hour: 7, minute: 0 } };
    expect(sameDaySession(sec(utc(2026, 10, 8, 10, 59)), w)).to.include({ ok: false, code: "before_create_window" });
    expect(sameDaySession(sec(utc(2026, 10, 8, 11, 0)), w).ok).to.equal(true);
  });

  it("CREATE_FROM_ET / CREATE_DEADLINE_ET default 07:00 / 08:00 and are validated at load", () => {
    const c = devnetCfg();
    expect(c.createFromEt).to.deep.equal({ hour: 7, minute: 0 });
    expect(c.createDeadlineEt).to.deep.equal({ hour: 8, minute: 0 });
    expect(devnetCfg({ CREATE_FROM_ET: "06:45" }).createFromEt).to.deep.equal({ hour: 6, minute: 45 });
    for (const v of ["7", "25:00", "07:60", "abc", "16:00"]) expect(() => devnetCfg({ CREATE_FROM_ET: v }), v).to.throw(/CREATE_FROM_ET/);
    expect(() => devnetCfg({ CREATE_FROM_ET: "08:30" })).to.throw(/CREATE_FROM_ET.*CREATE_DEADLINE_ET|deadline/);
    expect(() => devnetCfg({ CREATE_DEADLINE_ET: "16:00" })).to.throw(/CREATE_DEADLINE_ET/);
  });

  it("PRIOR_CLOSE_MAX_SKEW_SECS default 300, range 10..900; STRIKE_REF_MAX_AGE_SECS / CREATE_HOUR_ET are gone", () => {
    const c = devnetCfg();
    expect(c.priorCloseMaxSkewSecs).to.equal(300);
    expect(devnetCfg({ PRIOR_CLOSE_MAX_SKEW_SECS: "900" }).priorCloseMaxSkewSecs).to.equal(900);
    for (const v of ["5", "901", "x"]) expect(() => devnetCfg({ PRIOR_CLOSE_MAX_SKEW_SECS: v }), v).to.throw(/PRIOR_CLOSE_MAX_SKEW_SECS/);
    expect(c).not.to.have.property("strikeRefMaxAgeSecs");
    expect(c).not.to.have.property("createHourEt");
  });

  async function tick(now: Date, state = createCalendarState(), extra: Record<string, string> = { OPERATOR_STRIKE_PRICES: op("2026-10-08") }) {
    const created: string[] = [];
    const r = await captureLogs(() => runMorningCreate({
      cfg: devnetCfg(extra), program: {} as any, authority: Keypair.generate(), state, now,
      listOpen: async () => [], hermesAt: async () => { throw new Error("HTTP 403 not entitled"); },
      create: async (s) => (created.push(`${s.symbol}:${s.strikePriceE6.toString()}:${s.expiryTs.toNumber()}`), { market: Keypair.generate().publicKey, signature: "x" }),
    }));
    return { created, logs: r.logs, state };
  }

  it("06:59 ET → nothing (before_create_window); 07:00 ET → today's markets on the prior close, expiry 16:00 ET today", async () => {
    const early = await tick(utc(2026, 10, 8, 10, 59));
    expect(early.created).to.deep.equal([]);
    expect(early.logs.some((l) => /before_create_window/.test(l))).to.equal(true);
    expect(early.state.lastCreateDateKey).to.equal(null);
    const at7 = await tick(utc(2026, 10, 8, 11, 0));
    expect(at7.created).to.deep.equal([`AAPL:225000000:${CLOSE_1008}`, `MSFT:415000000:${CLOSE_1008}`]);
    expect(at7.state.lastCreateDateKey).to.equal("2026-10-08");
    expect(at7.logs.some((l) => /deadline/.test(l))).to.equal(false);
  });

  it("15:59 ET still creates (retries keep working all session); 16:00 ET refuses", async () => {
    expect((await tick(utc(2026, 10, 8, 19, 59))).created).to.have.length(2);
    expect((await tick(utc(2026, 10, 8, 20, 0))).created).to.deep.equal([]);
  });

  it("deadline ALERT: none before 08:00, once per day after, none once the day is done", async () => {
    const state = createCalendarState();
    const noPrice = {}; // no operator prices + Hermes 403 → nothing created
    const a = await tick(utc(2026, 10, 8, 11, 30), state, noPrice);
    expect(a.logs.filter((l) => /ALERT create deadline/.test(l))).to.have.length(0);
    const b = await tick(utc(2026, 10, 8, 12, 0), state, noPrice);
    const alerts = b.logs.filter((l) => /ALERT create deadline 08:00 ET missed for 2026-10-08/.test(l));
    expect(alerts, b.logs.join("\n")).to.have.length(1);
    const c = await tick(utc(2026, 10, 8, 12, 1), state, noPrice);
    expect(c.logs.filter((l) => /ALERT create deadline/.test(l))).to.have.length(0);
    // A new day re-arms it.
    const d = await tick(utc(2026, 10, 9, 12, 5), state, noPrice);
    expect(d.logs.filter((l) => /ALERT create deadline 08:00 ET missed for 2026-10-09/.test(l))).to.have.length(1);
    // Done before the deadline → no ALERT later.
    const done = createCalendarState();
    await tick(utc(2026, 10, 8, 11, 5), done);
    expect((await tick(utc(2026, 10, 8, 12, 30), done)).logs.filter((l) => /ALERT create deadline/.test(l))).to.have.length(0);
  });

  it("a late start (first tick after 08:00) still creates but ALERTs that the deadline was missed", async () => {
    const r = await tick(utc(2026, 10, 8, 13, 0));
    expect(r.created).to.have.length(2);
    expect(r.logs.filter((l) => /ALERT create deadline 08:00 ET missed for 2026-10-08/.test(l))).to.have.length(1);
  });
});

describe("D-026 strike reference = previous trading day's close", () => {
  const base = { symbol: "AAPL", dateKey: "2026-10-08", prevClose: { dateKey: "2026-10-07", closeTs: CLOSE_1007 }, feedIdHex: FEED_HEX, maxSkewSecs: 300, maxConfBps: 500 };

  it("Hermes price at the prior close: accept publish_time in [close, close + 300]", () => {
    const r = decideStrikeReference({ ...base, hermes: { parsed: px(CLOSE_1007 + 2) } });
    expect(r).to.deep.include({ ok: true, priceE6: 227_310_000n });
    if (r.ok) expect(r.source).to.equal(`hermes prior close 2026-10-07 publish_time=${CLOSE_1007 + 2} (+2s)`);
    expect(decideStrikeReference({ ...base, hermes: { parsed: px(CLOSE_1007 + 300) } }).ok).to.equal(true);
  });

  it("Hermes rejected: skew > 300 s, before the close, wrong feed, wide conf → refuse without an operator price", () => {
    const bad: Array<[string, PullPrice, RegExp]> = [
      ["skew", px(CLOSE_1007 + 301), /301s|skew/],
      ["before", px(CLOSE_1007 - 1), /before/],
      ["feed", px(CLOSE_1007 + 1, { feedIdHex: "bb".repeat(32) }), /feed/],
      ["conf", px(CLOSE_1007 + 1, { conf: 22731000000n / 100n * 6n }), /conf/],
    ];
    for (const [n, p, why] of bad) {
      const r = decideStrikeReference({ ...base, hermes: { parsed: p } });
      expect(r.ok, n).to.equal(false);
      expect(!r.ok && r.reason, n).to.match(why);
    }
  });

  it("on-chain PriceUpdateV2 counts only when its publish_time is at the prior close (a fresh one is not)", () => {
    const at = decideStrikeReference({ ...base, hermes: { error: "403" }, onchain: { parsed: px(CLOSE_1007 + 60), account: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW" } });
    expect(at).to.deep.include({ ok: true, priceE6: 227_310_000n });
    if (at.ok) expect(at.source).to.match(/^pyth account D9uk.* prior close 2026-10-07/);
    const fresh = decideStrikeReference({ ...base, hermes: { error: "403" }, onchain: { parsed: px(sec(utc(2026, 10, 8, 11, 30))), account: "D9uk" } });
    expect(fresh.ok).to.equal(false);
  });

  it("operator prior closes: dateKey = the market day; optional closeDateKey must be the previous trading day", () => {
    const o = (x: Record<string, unknown>) => ({ dateKey: "2026-10-08", source: "Nasdaq official close 2026-10-07", pricesE6: { AAPL: "227310000" }, ...x }) as any;
    expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: o({}) })).to.deep.include({ ok: true, priceE6: 227_310_000n, source: "operator: Nasdaq official close 2026-10-07" });
    expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: o({ closeDateKey: "2026-10-07" }) }).ok).to.equal(true);
    const wrong = decideStrikeReference({ ...base, hermes: { error: "403" }, operator: o({ closeDateKey: "2026-10-06" }) });
    expect(wrong.ok).to.equal(false);
    expect(!wrong.ok && wrong.reason).to.match(/closeDateKey|2026-10-06/);
    expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: o({ dateKey: "2026-10-07" }) }).ok).to.equal(false);
    expect(decideStrikeReference({ ...base, hermes: { error: "403" }, operator: o({ source: " " }) }).ok).to.equal(false);
  });

  it("strikeReferenceFor asks Hermes for the price AT the prior close (13:00 ET after an early close)", async () => {
    const asked: number[] = [];
    const hermesAt = async (_f: string, t: number) => (asked.push(t), px(t + 3));
    const r = await strikeReferenceFor(devnetCfg(), "AAPL", "2026-10-08", null, hermesAt);
    expect(asked).to.deep.equal([CLOSE_1007]);
    expect(r).to.include({ ok: true, priceE6: 227_310_000n });
    asked.length = 0;
    await strikeReferenceFor(devnetCfg(), "AAPL", "2026-11-30", null, hermesAt);
    expect(asked).to.deep.equal([sec(utc(2026, 11, 27, 18))]);
  });

  it("strikeReferenceFor: an on-chain account posted at the prior close is used (owner + Full checks unchanged)", async () => {
    const acct = Buffer.alloc(134);
    Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(acct, 0);
    acct[40] = 1;
    Buffer.from(FEED_HEX, "hex").copy(acct, 41);
    acct.writeBigInt64LE(41431000000n, 73);
    acct.writeBigUInt64LE(1000000n, 81);
    acct.writeInt32LE(-8, 89);
    acct.writeBigInt64LE(BigInt(CLOSE_1007 + 30), 93);
    const r = await strikeReferenceFor(devnetCfg(), "AAPL", "2026-10-08", null, async () => { throw new Error("403"); }, async () => ({ data: acct, owner: PYTH_RECEIVER_PROGRAM_ID }));
    expect(r).to.include({ ok: true, priceE6: 414_310_000n });
    const other = await strikeReferenceFor(devnetCfg(), "AAPL", "2026-10-08", null, async () => { throw new Error("403"); }, async () => ({ data: acct, owner: Keypair.generate().publicKey }));
    expect(other.ok).to.equal(false);
  });

  it("ops plan (ops-cli market-day --strikes) uses the same prior-close rule and reports the prior close", async () => {
    const cfg = devnetCfg({ OPERATOR_STRIKE_PRICES: JSON.stringify({ dateKey: "2026-10-08", closeDateKey: "2026-10-07", source: "op", pricesE6: { MSFT: "230000000" } }) }); // within ±20% of the Hermes anchor
    const r = await planDayForOps(cfg, sec(utc(2026, 10, 8, 11, 30)), async (_f, t) => {
      if (t !== CLOSE_1007) throw new Error(`asked ${t}`);
      return px(t + 1);
    });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r).to.include({ dateKey: "2026-10-08", prevDateKey: "2026-10-07", prevCloseTs: CLOSE_1007, closeTs: CLOSE_1008 });
    expect(r.markets.map((m) => [m.symbol, m.strikeE6, m.source.split(" ").slice(0, 3).join(" ")])).to.deep.equal([
      ["AAPL", "225000000", "hermes prior close"],
      ["MSFT", "225000000", "hermes prior close"],
    ]);
    // A fresh "latest" price at plan time is not the prior close → falls through to the operator prior close.
    const fresh = await planDayForOps(cfg, sec(utc(2026, 10, 8, 11, 30)), async () => px(sec(utc(2026, 10, 8, 11, 29))));
    expect(fresh.ok && fresh.markets.map((m) => [m.symbol, m.source])).to.deep.equal([["MSFT", "operator: op"]]);
    expect(fresh.ok && fresh.refused.map((x) => x.symbol)).to.deep.equal(["AAPL"]);
  });
});

describe("D-026 ops/operator-prices.cjs strike = prior closes, set from the prior close until 08:00 ET", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const opl = require(path.join(REPO, "ops/lib/operator-prices.cjs"));
  const ALL = ["AAPL=227.31", "MSFT=414.2", "GOOGL=162", "AMZN=186.05", "NVDA=138.5", "META=572.1", "TSLA=248.75"];
  const isoSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const v = (nowIso: string, o: Record<string, unknown> = {}) =>
    opl.validateOperatorPrices({ kind: "strike", source: "Nasdaq official close 2026-10-08", prices: opl.parsePriceArgs(ALL), nowSec: isoSec(nowIso), ...o });

  it("the evening before (after the prior close) → next market day, closeDateKey = the prior day; worker accepts it", () => {
    const r = v("2026-10-09T01:00:00Z"); // 2026-10-08 21:00 ET
    const j = JSON.parse(r.json);
    expect(j).to.deep.include({ dateKey: "2026-10-09", closeDateKey: "2026-10-08", source: "Nasdaq official close 2026-10-08" });
    expect(r.dateKey).to.equal("2026-10-09");
    const d = decideStrikeReference({ symbol: "AAPL", dateKey: "2026-10-09", prevClose: { dateKey: "2026-10-08", closeTs: CLOSE_1008 }, maxSkewSecs: 300, maxConfBps: 500, hermes: { error: "403" }, operator: j });
    expect(d).to.include({ ok: true, priceE6: 227310000n });
  });

  it("the same morning before 08:00 ET → today's market day; at/after 08:00 refused; --date for another day refused", () => {
    expect(JSON.parse(v("2026-10-09T11:59:00Z").json)).to.deep.include({ dateKey: "2026-10-09", closeDateKey: "2026-10-08" });
    expect(() => v("2026-10-09T12:00:00Z")).to.throw(/08:00/);
    expect(() => v("2026-10-09T11:30:00Z", { dateKey: "2026-10-08" })).to.throw(/2026-10-08/);
    expect(JSON.parse(v("2026-10-09T11:30:00Z", { dateKey: "2026-10-09" }).json).dateKey).to.equal("2026-10-09");
  });

  it("before the prior close is refused (the close is not known yet); a weekend sets Monday on Friday's close", () => {
    expect(() => v("2026-10-08T19:00:00Z")).to.throw(/close/); // 15:00 ET Thu: Thu close not yet
    expect(JSON.parse(v("2026-10-10T14:00:00Z").json)).to.deep.include({ dateKey: "2026-10-12", closeDateKey: "2026-10-09" });
  });

  it("the next session is an early close / holiday → refused (no 0DTE markets that day)", () => {
    expect(() => v("2026-11-26T14:00:00Z")).to.throw(/early/); // Thanksgiving → next session 11-27 is an early close
    expect(() => v("2026-11-25T14:00:00Z", { dateKey: "2026-11-26" })).to.throw(/holiday|2026-11-26/);
  });
});
