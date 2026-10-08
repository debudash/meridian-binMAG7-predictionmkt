/**
 * DLV-118 (SPEC §1 / §3.3): the calendar worker (prod/devnet) creates each trading day's markets at the 9:30 ET
 * open with expiry == THAT day's 16:00 ET close, strikes from a fresh reference price (Hermes when entitled, else an
 * operator price bound to the day), and settles at the close via the operator-sourced price while Hermes lacks
 * equities (DLV-106). After the close it never creates (no next-day roll).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { loadConfig } from "../src/config";
import { createCalendarState, planSameDayStrikes, runMorningCreate, runSettlePass, loadOperatorDayPrices } from "../src/modes/calendar";
import { encodeEquitySymbol } from "../src/strikes";

const utc = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const CLOSE_1008 = 1791489600; // 2026-10-08 16:00 EDT
const FEED_HEX = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

function devnetCfg(extra: Record<string, string> = {}) {
  const feeds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const s of ["AAPL", "MSFT"]) {
    feeds[s] = Keypair.generate().publicKey.toBase58();
    ids[s] = FEED_HEX;
  }
  return loadConfig({
    SOLANA_CLUSTER: "devnet",
    SOLANA_RPC_URL: "http://x",
    COLLATERAL_MINT: Keypair.generate().publicKey.toBase58(),
    STRIKE_SYMBOLS: "AAPL,MSFT",
    STRIKE_OFFSETS_E6: "0",
    PYTH_PRICE_FEEDS: JSON.stringify(feeds),
    PYTH_FEED_IDS: JSON.stringify(ids),
    ...extra,
  } as any);
}

const operator = (dateKey: string) =>
  JSON.stringify({ dateKey, source: "Nasdaq last sale 09:31 ET", pricesE6: { AAPL: "227310000", MSFT: "414200000" } });

describe("DLV-118 calendar create: same-day 16:00 ET expiry", () => {
  it("default symbols are the SPEC §1 MAG7 list", () => {
    expect(loadConfig({ SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any).symbols).to.deep.equal([
      "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
    ]);
  });

  it("planSameDayStrikes: expiry == today's close, ATM strike from the reference", () => {
    const cfg = devnetCfg();
    const r = planSameDayStrikes(cfg, Math.floor(utc(2026, 10, 8, 13, 31).getTime() / 1000), { AAPL: 227_310_000n });
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.strikes).to.have.length(1);
    expect(r.strikes[0].expiryTs.toNumber()).to.equal(CLOSE_1008);
    expect(r.strikes[0].strikePriceE6.toString()).to.equal("225000000");
  });

  it("planSameDayStrikes on DST dates: Mon 2026-11-02 (EST) close 21:00 UTC; Mon 2026-03-09 (EDT) 20:00 UTC", () => {
    const cfg = devnetCfg();
    const nov = planSameDayStrikes(cfg, Math.floor(utc(2026, 11, 2, 14, 31).getTime() / 1000), { AAPL: 227_000_000n });
    expect(nov.ok && nov.strikes[0].expiryTs.toNumber()).to.equal(Math.floor(utc(2026, 11, 2, 21).getTime() / 1000));
    const mar = planSameDayStrikes(cfg, Math.floor(utc(2026, 3, 9, 13, 31).getTime() / 1000), { AAPL: 227_000_000n });
    expect(mar.ok && mar.strikes[0].expiryTs.toNumber()).to.equal(Math.floor(utc(2026, 3, 9, 20).getTime() / 1000));
  });

  async function run(now: Date, cfgExtra: Record<string, string> = {}, existing: any[] = [], state = createCalendarState()) {
    const created: Array<{ symbol: string; expiry: number; strike: string }> = [];
    const out = await runMorningCreate({
      cfg: devnetCfg(cfgExtra),
      program: {} as any,
      authority: Keypair.generate(),
      state,
      now,
      listOpen: async () => existing,
      hermesLatest: async () => {
        throw new Error("Hermes key is valid but not entitled to this feed (HTTP 403)");
      },
      create: async (s) => {
        created.push({ symbol: s.symbol, expiry: s.expiryTs.toNumber(), strike: s.strikePriceE6.toString() });
        return { market: Keypair.generate().publicKey, signature: "sig" };
      },
    });
    return { out, created, state };
  }

  it("09:31 ET with Hermes 403 + operator prices for TODAY → one market per symbol, expiry == 16:00 ET today", async () => {
    const { created, state } = await run(utc(2026, 10, 8, 13, 31), { OPERATOR_STRIKE_PRICES: operator("2026-10-08") });
    expect(created).to.deep.equal([
      { symbol: "AAPL", expiry: CLOSE_1008, strike: "225000000" },
      { symbol: "MSFT", expiry: CLOSE_1008, strike: "415000000" },
    ]);
    expect(state.lastCreateDateKey).to.equal("2026-10-08");
  });

  it("before the 9:30 ET open → nothing (create happens at the open, not 08:00)", async () => {
    const { created } = await run(utc(2026, 10, 8, 13, 29), { OPERATOR_STRIKE_PRICES: operator("2026-10-08") });
    expect(created).to.deep.equal([]);
  });

  it("after the 16:00 ET close → REJECT: nothing created, and never a next-day (rolled) expiry", async () => {
    for (const now of [utc(2026, 10, 8, 20, 0), utc(2026, 10, 8, 23, 30), utc(2026, 10, 9, 1, 0)]) {
      const { created } = await run(now, { OPERATOR_STRIKE_PRICES: operator("2026-10-08") });
      expect(created, now.toISOString()).to.deep.equal([]);
    }
  });

  it("weekend and NYSE holiday → nothing", async () => {
    expect((await run(utc(2026, 10, 10, 14), { OPERATOR_STRIKE_PRICES: operator("2026-10-10") })).created).to.deep.equal([]);
    expect((await run(utc(2026, 11, 26, 15), { OPERATOR_STRIKE_PRICES: operator("2026-11-26") })).created).to.deep.equal([]);
  });

  it("no fresh price (Hermes 403, no / stale operator prices) → nothing created, day NOT marked done (retries next tick)", async () => {
    const a = await run(utc(2026, 10, 8, 13, 31));
    expect(a.created).to.deep.equal([]);
    expect(a.state.lastCreateDateKey).to.equal(null);
    const b = await run(utc(2026, 10, 8, 13, 31), { OPERATOR_STRIKE_PRICES: operator("2026-10-07") });
    expect(b.created).to.deep.equal([]);
  });

  it("idempotent after a restart: a symbol that already has an open market expiring today is skipped", async () => {
    const existing = [{ publicKey: Keypair.generate().publicKey, account: { status: 0, expiryTs: new BN(CLOSE_1008), equitySymbol: Array.from(encodeEquitySymbol("AAPL")) } }];
    const { created } = await run(utc(2026, 10, 8, 15), { OPERATOR_STRIKE_PRICES: operator("2026-10-08") }, existing);
    expect(created.map((c) => c.symbol)).to.deep.equal(["MSFT"]);
  });

  it("OPERATOR_STRIKE_PRICES_FILE is read at create time (operator can drop it after start)", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dlv118-")), "strike.json");
    const cfg = devnetCfg({ OPERATOR_STRIKE_PRICES_FILE: f });
    expect(loadOperatorDayPrices(cfg, "strike")).to.equal(null);
    fs.writeFileSync(f, operator("2026-10-08"));
    expect(loadOperatorDayPrices(cfg, "strike")?.pricesE6.AAPL).to.equal("227310000");
  });
});

describe("DLV-118 calendar settle: operator-sourced close price while Hermes lacks equities", () => {
  const strike = 225_000_000;
  const mk = () => ({
    publicKey: Keypair.generate().publicKey,
    account: {
      status: 0,
      expiryTs: new BN(CLOSE_1008),
      equitySymbol: Array.from(encodeEquitySymbol("AAPL")),
      strikePriceE6: new BN(strike),
      pythFeedId: Array.from(Buffer.from(FEED_HEX, "hex")),
      pythPriceFeed: Keypair.generate().publicKey,
    },
  });
  function program(calls: any[], markets: any[]) {
    return {
      programId: new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6"),
      provider: { connection: {} },
      account: {
        strikeMarket: { all: async () => markets },
        config: { fetch: async () => ({ settleMaxStalenessSlots: { toString: () => "150" }, settleMaxConfRatioBps: 500 }) },
      },
      methods: {
        adminSettle: (price: any, yes: boolean) => {
          const c: any = { accounts: () => c, signers: () => c, rpc: async () => (calls.push({ price: price.toString(), yes }), "sig") };
          return c;
        },
      },
    } as any;
  }
  const pull403 = () => ({
    getAccountInfo: async () => null,
    fetchUpdate: async () => {
      throw new Error("Hermes key is valid but not entitled to this feed (HTTP 403)");
    },
    settleWithAccount: async () => "x",
    postAndSettle: async () => ["x"],
  });
  async function settle(extra: Record<string, string>) {
    const calls: any[] = [];
    const m = mk();
    await runSettlePass({
      cfg: devnetCfg({ ADMIN_SETTLE_AFTER_RETRIES: "1", ...extra }),
      program: program(calls, [m]),
      authority: Keypair.generate(),
      state: createCalendarState(),
      now: new Date((CLOSE_1008 + 400) * 1000),
      pullDeps: pull403 as any,
    });
    return calls;
  }

  it("operator close prices for the market's ET day → admin_settle at that price, outcome from price ≥ strike", async () => {
    const yes = await settle({ OPERATOR_CLOSE_PRICES: JSON.stringify({ dateKey: "2026-10-08", source: "Nasdaq official close", pricesE6: { AAPL: "227310000" } }) });
    expect(yes).to.deep.equal([{ price: "227310000", yes: true }]);
    const touch = await settle({ OPERATOR_CLOSE_PRICES: JSON.stringify({ dateKey: "2026-10-08", source: "s", pricesE6: { AAPL: String(strike) } }) });
    expect(touch).to.deep.equal([{ price: String(strike), yes: true }]);
    const no = await settle({ OPERATOR_CLOSE_PRICES: JSON.stringify({ dateKey: "2026-10-08", source: "s", pricesE6: { AAPL: "224990000" } }) });
    expect(no).to.deep.equal([{ price: "224990000", yes: false }]);
  });

  it("refuses close prices for another day, without a source, or the old unsourced static ADMIN_SETTLE_PRICE_E6 off-localnet", async () => {
    expect(await settle({ OPERATOR_CLOSE_PRICES: JSON.stringify({ dateKey: "2026-10-07", source: "s", pricesE6: { AAPL: "1" } }) })).to.deep.equal([]);
    expect(await settle({ OPERATOR_CLOSE_PRICES: JSON.stringify({ dateKey: "2026-10-08", source: "", pricesE6: { AAPL: "1" } }) })).to.deep.equal([]);
    expect(await settle({ ADMIN_SETTLE_PRICE_E6: "180000000", ADMIN_SETTLE_OUTCOME_YES: "true" })).to.deep.equal([]);
  });
});


describe("DLV-118 ops plan (ops-cli market-day --strikes → devnet-bootstrap TODAY_PLAN)", () => {
  it("one ATM strike per symbol, expiry = today's close; symbols without a fresh price are listed as refused", async () => {
    const { planDayForOps } = await import("../src/modes/calendar");
    const cfg = devnetCfg({ OPERATOR_STRIKE_PRICES: JSON.stringify({ dateKey: "2026-10-08", source: "op", pricesE6: { AAPL: "227310000" } }) });
    const r = await planDayForOps(cfg, Math.floor(utc(2026, 10, 8, 13, 0).getTime() / 1000));
    expect(r.ok).to.equal(true);
    if (!r.ok) return;
    expect(r.closeTs).to.equal(CLOSE_1008);
    expect(r.markets).to.deep.equal([{ symbol: "AAPL", strikeE6: "225000000", refE6: "227310000", source: "operator: op" }]);
    expect(r.refused.map((x) => x.symbol)).to.deep.equal(["MSFT"]);
    const late = await planDayForOps(cfg, CLOSE_1008 + 1);
    expect(late).to.include({ ok: false, code: "after_close" });
  });

  it("create uses a fresh sponsored on-chain account when Hermes is 403 (readAccount seam)", async () => {
    const created: string[] = [];
    const now = utc(2026, 10, 8, 13, 31);
    const nowSec = Math.floor(now.getTime() / 1000);
    const acct = Buffer.alloc(134);
    Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(acct, 0);
    acct[40] = 1; // Full
    Buffer.from(FEED_HEX, "hex").copy(acct, 41);
    acct.writeBigInt64LE(41431000000n, 73); // 414.31 @ expo -8
    acct.writeBigUInt64LE(1000000n, 81);
    acct.writeInt32LE(-8, 89);
    acct.writeBigInt64LE(BigInt(nowSec - 60), 93);
    await runMorningCreate({
      cfg: devnetCfg(), program: {} as any, authority: Keypair.generate(), state: createCalendarState(), now,
      listOpen: async () => [], hermesLatest: async () => { throw new Error("403"); },
      readAccount: async () => acct,
      create: async (s) => (created.push(`${s.symbol}:${s.strikePriceE6.toString()}:${s.expiryTs.toNumber()}`), { market: Keypair.generate().publicKey, signature: "x" }),
    });
    expect(created).to.deep.equal([`AAPL:415000000:${CLOSE_1008}`, `MSFT:415000000:${CLOSE_1008}`]);
  });
});
