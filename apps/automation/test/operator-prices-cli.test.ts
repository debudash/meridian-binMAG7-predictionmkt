/**
 * Operator-entered equity prices for staging (Debu-approved while Hermes lacks equities): ops/operator-prices.cjs
 * validates a day's strike / close prices (+ required source) and sets OPERATOR_STRIKE_PRICES / OPERATOR_CLOSE_PRICES on
 * Railway meridian-staging/automation with the project token. The JSON it writes is what the worker parses.
 */
import * as path from "path";
import { expect } from "chai";
import { decideStrikeReference } from "../src/marketDay";

const REPO = path.resolve(__dirname, "../../..");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const op = require(path.join(REPO, "ops/lib/operator-prices.cjs"));
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const ALL = ["AAPL=227.31", "MSFT=414.2", "GOOGL=162", "AMZN=186.05", "NVDA=138.5", "META=572.1", "TSLA=248.75"];

describe("ops/operator-prices.cjs (operator strike / close prices → Railway)", () => {
  it("parses SYMBOL=price (≤ 6 dp) into integer micro-USD strings", () => {
    expect(op.parsePriceArgs(["aapl=227.31", "MSFT=414.200001"])).to.deep.equal({ AAPL: "227310000", MSFT: "414200001" });
    for (const bad of [["AAPL=0"], ["AAPL=-1"], ["AAPL=abc"], ["AAPL=1.1234567"], ["AAPL"], ["AAPL=1", "AAPL=2"]]) expect(() => op.parsePriceArgs(bad), bad.join(" ")).to.throw();
  });

  it("strike before the open on a trading day → OPERATOR_STRIKE_PRICES JSON the worker accepts", () => {
    const r = op.validateOperatorPrices({ kind: "strike", source: "Nasdaq pre-market last sale 09:10 ET", prices: op.parsePriceArgs(ALL), nowSec: sec("2026-10-09T13:10:00Z") });
    expect(r.varName).to.equal("OPERATOR_STRIKE_PRICES");
    const j = JSON.parse(r.json);
    expect(j).to.deep.include({ dateKey: "2026-10-09", source: "Nasdaq pre-market last sale 09:10 ET" });
    expect(Object.keys(j.pricesE6)).to.have.length(7);
    const d = decideStrikeReference({ symbol: "AAPL", dateKey: "2026-10-09", nowSec: sec("2026-10-09T13:31:00Z"), maxAgeSecs: 300, maxConfBps: 500, hermes: { error: "403" }, operator: j });
    expect(d).to.include({ ok: true, priceE6: 227310000n });
    expect(r.warnings).to.deep.equal([]);
  });

  it("refuses: missing ticker, extra ticker, empty source, wrong date, weekend, holiday, early close", () => {
    const now = sec("2026-10-09T13:10:00Z");
    const v = (o: any) => () => op.validateOperatorPrices({ kind: "strike", source: "src", prices: op.parsePriceArgs(ALL), nowSec: now, ...o });
    expect(v({ prices: op.parsePriceArgs(ALL.slice(1)) })).to.throw(/AAPL/);
    expect(v({ prices: op.parsePriceArgs([...ALL, "SPY=570"]) })).to.throw(/SPY/);
    expect(v({ source: "  " })).to.throw(/source/);
    expect(v({ dateKey: "2026-10-08" })).to.throw(/today/);
    expect(v({ nowSec: sec("2026-10-10T14:00:00Z"), dateKey: undefined })).to.throw(/weekend/);
    expect(v({ nowSec: sec("2026-11-26T14:00:00Z") })).to.throw(/holiday/);
    expect(v({ nowSec: sec("2026-11-27T14:00:00Z") })).to.throw(/early/);
  });

  it("timing: strike at/after the close refused (late strike warns); close before 16:00 ET refused", () => {
    const p = op.parsePriceArgs(ALL);
    expect(() => op.validateOperatorPrices({ kind: "strike", source: "s", prices: p, nowSec: sec("2026-10-09T20:00:00Z") })).to.throw(/close/);
    const late = op.validateOperatorPrices({ kind: "strike", source: "s", prices: p, nowSec: sec("2026-10-09T15:00:00Z") });
    expect(late.warnings.join(" ")).to.match(/09:30/);
    expect(() => op.validateOperatorPrices({ kind: "close", source: "s", prices: p, nowSec: sec("2026-10-09T19:59:00Z") })).to.throw(/16:00/);
    const c = op.validateOperatorPrices({ kind: "close", source: "Nasdaq official close", prices: p, nowSec: sec("2026-10-09T20:05:00Z") });
    expect(c.varName).to.equal("OPERATOR_CLOSE_PRICES");
    expect(JSON.parse(c.json).dateKey).to.equal("2026-10-09");
  });

  it("railway call: project token only (RAILWAY_API_TOKEN removed), value via stdin (never argv), automation service", () => {
    const env = op.railwayEnv({ RAILWAY_PROJECT_TOKEN: "p", RAILWAY_API_TOKEN: "a", PATH: "/bin" });
    expect(env.RAILWAY_TOKEN).to.equal("p");
    expect(env).not.to.have.property("RAILWAY_API_TOKEN");
    expect(() => op.railwayEnv({ RAILWAY_API_TOKEN: "a" })).to.throw(/RAILWAY_PROJECT_TOKEN/);
    const args = op.railwayArgs("OPERATOR_STRIKE_PRICES", { skipDeploys: false });
    expect(args).to.deep.equal(["variable", "set", "OPERATOR_STRIKE_PRICES", "--stdin", "--service", "automation"]);
    expect(op.railwayArgs("OPERATOR_CLOSE_PRICES", { skipDeploys: true })).to.include("--skip-deploys");
    expect(op.railwayRedeployArgs()).to.deep.equal(["redeploy", "--service", "automation", "--yes"]);
    expect(op.railwayArgs("OPERATOR_STRIKE_PRICES", { skipDeploys: false, clear: true })).to.deep.equal(["variable", "set", "OPERATOR_STRIKE_PRICES=", "--service", "automation"]);
  });
});
