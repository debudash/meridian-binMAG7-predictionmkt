/** DLV-118: localnet today's-close market plan (scripts/localnet/lib/today-plan.cjs) uses the shared marketDay rule. */
import { expect } from "chai";
import * as md from "../src/marketDay";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plan = require("../../../scripts/localnet/lib/today-plan.cjs");

const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Math.floor(Date.UTC(y, mo - 1, d, h, mi) / 1000);

describe("DLV-118 localnet today-markets plan", () => {
  it("all 7 MAG7 tickers, expiry == the effective day's 16:00 ET close, ATM strikes from the mock reference", () => {
    const r = plan.planTodayMarkets(md, { nowSec: utc(2026, 10, 8, 18, 40), symbols: [...md.MAG7] });
    expect(r.ok).to.equal(true);
    expect(r.session.closeTs).to.equal(1791489600);
    expect(r.markets.map((m: any) => m.symbol)).to.deep.equal(["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]);
    for (const m of r.markets) expect(m.expiryTs).to.equal(1791489600);
    const by = Object.fromEntries(r.markets.map((m: any) => [m.symbol, m]));
    expect(by.AAPL.strikeE6).to.equal(225_000_000n);
    expect(by.AMZN.strikeE6).to.equal(185_000_000n);
    expect(by.GOOGL.strikeE6).to.equal(160_000_000n);
    expect(by.NVDA.strikeE6).to.equal(140_000_000n);
    expect(by.AAPL.mockPriceE8).to.equal(22_500_000_000n);
    expect(by.AAPL.fairYes).to.equal(0.5);
  });

  it("SimClock time drives the day: a sim clock on 2026-11-02 (EST) plans that day's 21:00 UTC close", () => {
    const r = plan.planTodayMarkets(md, { nowSec: utc(2026, 11, 2, 15), symbols: ["AAPL"] });
    expect(r.ok && r.markets[0].expiryTs).to.equal(utc(2026, 11, 2, 21));
  });

  it("after the close it refuses (no next-day roll); weekends refuse unless ALLOW_NON_TRADING_DAY", () => {
    expect(plan.planTodayMarkets(md, { nowSec: 1791489600, symbols: ["AAPL"] })).to.include({ ok: false, code: "after_close" });
    expect(plan.planTodayMarkets(md, { nowSec: utc(2026, 10, 10, 15), symbols: ["AAPL"] })).to.include({ ok: false, code: "weekend" });
    expect(plan.planTodayMarkets(md, { nowSec: utc(2026, 10, 10, 15), symbols: ["AAPL"], allowNonTradingDay: true }).ok).to.equal(true);
  });

  it("REF_PRICES overrides parse to micro-USD; non-MAG7 symbols are refused", () => {
    expect(plan.parseRefPrices("AAPL=227.31, msft=415")).to.deep.equal({ AAPL: 227_310_000n, MSFT: 415_000_000n });
    expect(() => plan.parseRefPrices("AAPL=abc")).to.throw(/bad REF_PRICES/);
    const r = plan.planTodayMarkets(md, { nowSec: utc(2026, 10, 8, 18), symbols: ["AAPL"], refPricesE6: { AAPL: 227_310_000n } });
    expect(r.markets[0].strikeE6).to.equal(225_000_000n);
    expect(r.markets[0].fairYes).to.equal(0.54);
    expect(() => plan.planTodayMarkets(md, { nowSec: utc(2026, 10, 8, 18), symbols: ["NFLX"] })).to.throw(/MAG7/);
  });
});
