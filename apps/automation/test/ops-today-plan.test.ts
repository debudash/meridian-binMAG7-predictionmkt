/** DLV-118: devnet-bootstrap uses TODAY's plan (ops/lib/today-plan.cjs); run-staging computes it with ops-cli market-day. */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bootstrapPlanFromToday } = require("../../../ops/lib/today-plan.cjs");

const CLOSE = 1791489600;
const today = {
  ok: true, dateKey: "2026-10-08", openTs: 1791466200, closeTs: CLOSE,
  markets: [
    { symbol: "AAPL", strikeE6: "225000000", refE6: "227310000", source: "operator: x" },
    { symbol: "MSFT", strikeE6: "415000000", refE6: "414200000", source: "operator: x" },
    { symbol: "META", strikeE6: "570000000", refE6: "572000000", source: "operator: x" },
  ],
  refused: [],
};
const feeds = { AAPL: ["a", "b"], MSFT: ["a", "b"], META: ["a", "b"] };

describe("DLV-118 devnet-bootstrap today plan", () => {
  it("regular markets expire at TODAY's 16:00 ET close with strikes from the fresh reference; books up to NBOOKS", () => {
    const p = bootstrapPlanFromToday(today, { nbooks: 2, feeds, nowSec: CLOSE - 3600 });
    expect(p.regular.map((m: any) => [m.symbol, m.strike, m.expiry, m.book])).to.deep.equal([
      ["AAPL", 225, CLOSE, true], ["MSFT", 415, CLOSE, true], ["META", 570, CLOSE, false],
    ]);
    expect(p.short).to.deep.equal({ symbol: "AAPL", strike: 225 });
  });

  it("after the close / no session / no priced market → throws (never next-close books)", () => {
    expect(() => bootstrapPlanFromToday(today, { nbooks: 3, feeds, nowSec: CLOSE })).to.throw(/same-day only/);
    expect(() => bootstrapPlanFromToday({ ok: false, code: "after_close", reason: "r" }, { nbooks: 3, feeds, nowSec: 0 })).to.throw(/never next-close/);
    expect(() => bootstrapPlanFromToday({ ...today, markets: [] }, { nbooks: 3, feeds, nowSec: CLOSE - 1 })).to.throw(/OPERATOR_STRIKE_PRICES_FILE/);
  });

  it("devnet-bootstrap.cjs / run-staging.sh no longer hardcode a next-close expiry or AAPL ≥ 300", () => {
    const boot = fs.readFileSync(path.resolve(__dirname, "../../../ops/devnet-bootstrap.cjs"), "utf8");
    const run = fs.readFileSync(path.resolve(__dirname, "../../../ops/run-staging.sh"), "utf8");
    expect(boot).to.not.match(/EXPIRY_FRI|Date\.UTC\(2026/);
    expect(boot).to.not.match(/strike:\s*300\b/);
    expect(boot).to.match(/bootstrapPlanFromToday/);
    expect(run).to.match(/market-day --strikes/);
    expect(run).to.not.match(/Friday markets/);
  });
});
