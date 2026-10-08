/**
 * DLV-119: Meridian Reviewers' findings on !91 (DLV-118) — M-1 early closes, L-1…L-8, nits.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { loadConfig } from "../src/config";
import {
  isTradingDay, sameDaySession, nextTradingDay, calendarHorizonAlert, decideStrikeReference, NYSE_HOLIDAYS, NYSE_EARLY_CLOSES,
} from "../src/marketDay";
import { createCalendarState, runMorningCreate, planDayForOps, planSameDayStrikes, strikeReferenceFor } from "../src/modes/calendar";
import { PYTH_RECEIVER_PROGRAM_ID } from "../src/pyth/pullOracle";

const REPO = path.resolve(__dirname, "../../..");
const utc = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const FEED_HEX = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
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
const op = (dateKey: string, prices: Record<string, string> = { AAPL: "227310000", MSFT: "414200000" }) =>
  JSON.stringify({ dateKey, source: "Nasdaq last sale 09:31 ET", pricesE6: prices });

function captureLogs<T>(fn: () => Promise<T>): Promise<{ out: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  return fn().then((out) => { console.log = orig; return { out, logs }; }, (e) => { console.log = orig; throw e; });
}

function pxAccount(nowSec: number, opts: { full?: boolean; priceE8?: bigint } = {}) {
  const full = opts.full ?? true;
  const acct = Buffer.alloc(134);
  Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(acct, 0);
  acct[40] = full ? 1 : 0;
  const o = full ? 41 : 42;
  Buffer.from(FEED_HEX, "hex").copy(acct, o);
  acct.writeBigInt64LE(opts.priceE8 ?? 41431000000n, o + 32);
  acct.writeBigUInt64LE(1000000n, o + 40);
  acct.writeInt32LE(-8, o + 48);
  acct.writeBigInt64LE(BigInt(nowSec - 60), o + 52);
  return acct;
}

describe("DLV-119 M-1: NYSE early-close days (13:00 ET) are refused with an ALERT", () => {
  it("early-close table matches nyse.com (2026-11-27, 2026-12-24, 2027-11-26, 2028-07-03, 2028-11-24); 2027-07-02 is a full day", () => {
    expect(Object.keys(NYSE_EARLY_CLOSES).sort()).to.deep.equal(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
    for (const d of Object.keys(NYSE_EARLY_CLOSES)) expect(isTradingDay(d), d).to.include({ ok: false, code: "early_close" });
    expect(isTradingDay("2027-07-02")).to.deep.equal({ ok: true });
    expect(isTradingDay("2026-07-02")).to.deep.equal({ ok: true });
  });

  it("sameDaySession refuses an early-close day (even mid-morning) and nextTradingDay skips it", () => {
    const r = sameDaySession(sec(utc(2026, 11, 27, 15)), { notBeforeEt: { hour: 7, minute: 0 } });
    expect(r).to.include({ ok: false, code: "early_close", dateKey: "2026-11-27" });
    expect(nextTradingDay("2026-11-25")).to.equal("2026-11-30");
    expect(nextTradingDay("2026-12-23")).to.equal("2026-12-28");
  });

  it("worker: 2026-11-27 10:00 ET → nothing created, ALERT logged, day not marked done", async () => {
    const created: string[] = [];
    const state = createCalendarState();
    const { logs } = await captureLogs(() => runMorningCreate({
      cfg: devnetCfg({ OPERATOR_STRIKE_PRICES: op("2026-11-27") }), program: {} as any, authority: Keypair.generate(), state,
      now: utc(2026, 11, 27, 15), listOpen: async () => [], hermesAt: async () => { throw new Error("403"); },
      create: async (s) => (created.push(s.symbol), { market: Keypair.generate().publicKey, signature: "x" }),
    }));
    expect(created).to.deep.equal([]);
    expect(logs.some((l) => /ALERT/.test(l) && /early_close/.test(l)), logs.join("\n")).to.equal(true);
    expect(state.lastCreateDateKey).to.equal(null);
  });

  it("ops plan (ops-cli market-day) refuses an early-close day", async () => {
    const r = await planDayForOps(devnetCfg({ OPERATOR_STRIKE_PRICES: op("2026-12-24") }), sec(utc(2026, 12, 24, 15)));
    expect(r).to.include({ ok: false, code: "early_close" });
  });
});

describe("DLV-119 nits: 2028 calendar, horizon ALERT, STRIKE_STEP_E6, operator sanity band", () => {
  it("2028 NYSE holidays are known (no Jan 1 holiday: Saturday); 2029 still refuses", () => {
    for (const d of ["2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"]) {
      expect(isTradingDay(d), d).to.include({ ok: false, code: "holiday" });
      expect(NYSE_HOLIDAYS[d], d).to.be.a("string");
    }
    expect(isTradingDay("2028-01-03")).to.deep.equal({ ok: true });
    expect(isTradingDay("2029-01-02")).to.include({ ok: false, code: "unknown_year" });
  });

  it("calendarHorizonAlert: ALERT text when a date ≤ 30 days ahead is in an unknown year, else null", () => {
    expect(calendarHorizonAlert(sec(utc(2026, 10, 8, 14)))).to.equal(null);
    expect(calendarHorizonAlert(sec(utc(2028, 12, 5, 14)))).to.match(/ALERT.*2029/);
  });

  it("STRIKE_STEP_E6 must be a positive integer (0 / negative / junk refuse at load, not mid-create)", () => {
    for (const v of ["0", "-5000000", "abc", "1.5"]) expect(() => devnetCfg({ STRIKE_STEP_E6: v }), v).to.throw(/STRIKE_STEP_E6/);
    expect(devnetCfg({ STRIKE_STEP_E6: "1000000" }).strikeStepE6).to.equal(1_000_000n);
  });

  it("operator strike must be within ±20% of the last known Pyth price when one exists (stale is fine as a sanity anchor)", () => {
    const nowSec = sec(utc(2026, 10, 8, 13, 31));
    const stale = { feedIdHex: FEED_HEX, price: 22700000000n, conf: 1000000n, expo: -8, publishTime: nowSec - 86400, prevPublishTime: nowSec - 86401 };
    const base = { symbol: "AAPL", dateKey: "2026-10-08", prevClose: { dateKey: "2026-10-07", closeTs: CLOSE_1008 - 86400 }, feedIdHex: FEED_HEX, maxSkewSecs: 300, maxConfBps: 500, hermes: { error: "403" } as const, onchain: { parsed: stale, account: "Acct" } };
    const bad = decideStrikeReference({ ...base, operator: { dateKey: "2026-10-08", source: "op", pricesE6: { AAPL: "400000000" } } });
    expect(bad.ok).to.equal(false);
    expect(!bad.ok && bad.reason).to.match(/band|±20%/);
    const good = decideStrikeReference({ ...base, operator: { dateKey: "2026-10-08", source: "op", pricesE6: { AAPL: "230000000" } } });
    expect(good).to.include({ ok: true, priceE6: 230000000n });
  });
});

describe("DLV-119 L-1 / L-3: no blind create; failed create ALERTs and the day stays open (idempotent retry)", () => {
  it("L-1: open-market scan failure → abort create + ALERT, day not done", async () => {
    const created: string[] = [];
    const state = createCalendarState();
    const { logs } = await captureLogs(() => runMorningCreate({
      cfg: devnetCfg({ OPERATOR_STRIKE_PRICES: op("2026-10-08") }), program: {} as any, authority: Keypair.generate(), state,
      now: utc(2026, 10, 8, 13, 31), listOpen: async () => { throw new Error("429 Too Many Requests"); },
      hermesAt: async () => { throw new Error("403"); },
      create: async (s) => (created.push(s.symbol), { market: Keypair.generate().publicKey, signature: "x" }),
    }));
    expect(created).to.deep.equal([]);
    expect(state.lastCreateDateKey).to.equal(null);
    expect(logs.some((l) => /ALERT/.test(l) && /scan/.test(l))).to.equal(true);
  });

  it("L-3: a failed create is an ALERT, the day stays open; the retry creates only what is missing at the ORIGINAL strikes", async () => {
    const state = createCalendarState();
    const onChain: any[] = [];
    let failAapl = true;
    const created: string[] = [];
    const runOnce = (prices: Record<string, string>) => captureLogs(() => runMorningCreate({
      cfg: devnetCfg({ OPERATOR_STRIKE_PRICES: op("2026-10-08", prices) }), program: {} as any, authority: Keypair.generate(), state,
      now: utc(2026, 10, 8, 13, 31), listOpen: async () => onChain, hermesAt: async () => { throw new Error("403"); },
      create: async (s) => {
        if (s.symbol === "AAPL" && failAapl) throw new Error("Attempt to debit an account but found no record of a prior credit");
        created.push(`${s.symbol}:${s.strikePriceE6.toString()}`);
        onChain.push({ publicKey: Keypair.generate().publicKey, account: { equitySymbol: Array.from(Buffer.from(s.symbol.padEnd(8, " "))), expiryTs: s.expiryTs, strikePriceE6: s.strikePriceE6 } });
        return { market: Keypair.generate().publicKey, signature: "x" };
      },
    }));
    const first = await runOnce({ AAPL: "227310000", MSFT: "414200000" });
    expect(created).to.deep.equal(["MSFT:415000000"]);
    expect(state.lastCreateDateKey).to.equal(null);
    expect(first.logs.some((l) => /ALERT/.test(l) && /create failed/.test(l) && /AAPL/.test(l))).to.equal(true);
    failAapl = false;
    await runOnce({ AAPL: "241000000", MSFT: "430000000" }); // reference moved: still the first plan's strikes
    expect(created).to.deep.equal(["MSFT:415000000", "AAPL:225000000"]);
    expect(state.lastCreateDateKey).to.equal("2026-10-08");
  });
});

describe("DLV-119 L-5: localnet-only paths need a loopback RPC", () => {
  it("SOLANA_CLUSTER=localnet on a non-loopback RPC refuses to load", () => {
    expect(() => loadConfig({ SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: "https://api.devnet.solana.com" } as any)).to.throw(/loopback/);
    expect(loadConfig({ SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: "http://127.0.0.1:8899" } as any).cluster).to.equal("localnet");
    expect(loadConfig({ SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: "http://localhost:8899" } as any).cluster).to.equal("localnet");
  });
});

describe("DLV-119 L-6: on-chain strike reference = Pyth receiver owner + Full verification; --strikes needs a feed id", () => {
  const nowSec = sec(utc(2026, 10, 8, 13, 31));
  const ref = (acct: { data: Buffer; owner: PublicKey } | null) =>
    strikeReferenceFor(devnetCfg(), "AAPL", "2026-10-08", null, async () => { throw new Error("403"); }, async () => acct);
  it("wrong owner → not used", async () => {
    const r = await ref({ data: pxAccount(nowSec), owner: Keypair.generate().publicKey });
    expect(r.ok).to.equal(false);
    expect(!r.ok && r.reason).to.match(/owner/);
  });
  it("partial verification → not used", async () => {
    const r = await ref({ data: pxAccount(nowSec, { full: false }), owner: PYTH_RECEIVER_PROGRAM_ID });
    expect(r.ok).to.equal(false);
    expect(!r.ok && r.reason).to.match(/Full|verif/);
  });
  it("receiver-owned + Full + posted at the prior close → used", async () => {
    const r = await ref({ data: pxAccount(CLOSE_1008 - 86400 + 60), owner: PYTH_RECEIVER_PROGRAM_ID });
    expect(r).to.include({ ok: true, priceE6: 414310000n });
  });
  it("planDayForOps refuses a symbol without a PYTH_FEED_IDS entry", async () => {
    const cfg = devnetCfg({ OPERATOR_STRIKE_PRICES: op("2026-10-08") });
    delete cfg.pythFeedIds.MSFT;
    const r = await planDayForOps(cfg, nowSec);
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.markets.map((m) => m.symbol)).to.deep.equal(["AAPL"]);
    expect(r.refused).to.have.length(1);
    expect(r.refused[0].symbol).to.equal("MSFT");
    expect(r.refused[0].reason).to.match(/PYTH_FEED_IDS/);
  });
});

describe("DLV-119 L-8: no static PHOENIX_MARKETS binding for new daily markets", () => {
  it("planSameDayStrikes never carries a PHOENIX_MARKETS pubkey; worker ALERTs that the mapping is ignored", async () => {
    const stale = Keypair.generate().publicKey.toBase58();
    const cfg = devnetCfg({ PHOENIX_MARKETS: JSON.stringify({ AAPL: stale }), OPERATOR_STRIKE_PRICES: op("2026-10-08") });
    const p = planSameDayStrikes(cfg, sec(utc(2026, 10, 8, 13, 31)), { AAPL: 227_000_000n });
    expect(p.ok && p.strikes[0].phoenixMarket.equals(PublicKey.default)).to.equal(true);
    const specs: any[] = [];
    const { logs } = await captureLogs(() => runMorningCreate({
      cfg, program: {} as any, authority: Keypair.generate(), state: createCalendarState(), now: utc(2026, 10, 8, 13, 31),
      listOpen: async () => [], hermesAt: async () => { throw new Error("403"); },
      create: async (s) => (specs.push(s), { market: Keypair.generate().publicKey, signature: "x" }),
    }));
    expect(specs.every((s) => s.phoenixMarket.equals(PublicKey.default))).to.equal(true);
    expect(logs.some((l) => /ALERT/.test(l) && /PHOENIX_MARKETS/.test(l))).to.equal(true);
  });
});

describe("DLV-119 ops: one creator, L-2 duplicates, L-4 20-min cap, pause lead, explicit localnet RPC", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tp = require(path.join(REPO, "ops/lib/today-plan.cjs"));
  it("L-4: the 20-min market is capped at today's close (refused when it would not fit)", () => {
    const at = (h: number, m: number) => sec(utc(2026, 10, 8, h, m));
    expect(tp.shortExpiryFor({ closeTs: CLOSE_1008 }, at(18, 0), 20, 180)).to.equal(at(18, 0) + 1380);
    expect(() => tp.shortExpiryFor({ closeTs: CLOSE_1008 }, at(19, 38), 20, 180)).to.throw(/close/);
  });
  it("L-2: same-day duplicates are detected before create (same symbol + expiry, different PDA)", () => {
    const plan = [{ symbol: "AAPL", expiry: CLOSE_1008, market: "P1" }, { symbol: "MSFT", expiry: CLOSE_1008, market: "P2" }];
    const existing = [{ symbol: "AAPL", expiry: CLOSE_1008, market: "W1" }, { symbol: "MSFT", expiry: CLOSE_1008 - 86400, market: "Old" }, { symbol: "MSFT", expiry: CLOSE_1008, market: "P2" }];
    expect(tp.sameDayDuplicates(plan, existing)).to.deep.equal([{ symbol: "AAPL", planned: "P1", existing: ["W1"] }]);
  });
  it("bootstrap: daily markets OFF unless BOOTSTRAP_DAILY_MARKETS=1; duplicate scan + short cap wired; run-staging phase 1 doesn't need a plan when off", () => {
    const b = fs.readFileSync(path.join(REPO, "ops/devnet-bootstrap.cjs"), "utf8");
    expect(b).to.match(/BOOTSTRAP_DAILY_MARKETS/);
    expect(b).to.match(/sameDayDuplicates\(/);
    expect(b).to.match(/shortExpiryFor\(/);
    const r = fs.readFileSync(path.join(REPO, "ops/run-staging.sh"), "utf8");
    expect(r).to.match(/BOOTSTRAP_DAILY_MARKETS/);
    expect(r).to.match(/PHOENIX_PAUSE_LEAD_SECS=\$\{PHOENIX_PAUSE_LEAD_SECS:-5\}/);
    expect(r).to.match(/early_close/);
  });
  it("today-markets.cjs requires an explicit RPC (no :8899 default)", () => {
    const s = fs.readFileSync(path.join(REPO, "scripts/localnet/today-markets.cjs"), "utf8");
    expect(s).not.to.match(/process\.env\.RPC \|\| "http:\/\/127\.0\.0\.1:8899"/);
    expect(s).to.match(/RPC required/);
  });
  it("box NYSE calendar copy (ops/lib/nyse-calendar.cjs) equals marketDay's tables", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cal = require(path.join(REPO, "ops/lib/nyse-calendar.cjs"));
    expect(cal.NYSE_HOLIDAYS).to.deep.equal(NYSE_HOLIDAYS);
    expect(cal.NYSE_EARLY_CLOSES).to.deep.equal(NYSE_EARLY_CLOSES);
  });
});
