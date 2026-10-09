import { expect } from "chai";
import { buildFacts, type ChainMarket } from "../src/copilot/facts";
import { summarize, templateSummary, verifyNumbers, type CopilotClient } from "../src/copilot/summarize";
import { notify } from "../src/copilot/notify";

// Fixture = the real 2026-10-09 devnet day (DEPLOY / TEST_RESULTS §8): 7 MAG7 markets, all settled by the Pyth pull oracle.
const DATE = "2026-10-09";
const CLOSE = 1791576000; // 16:00 ET
const MAG7 = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const DAY: Array<[string, number, number, number]> = [
  // symbol, strike, close, status (2 = settled YES, 3 = settled NO)
  ["AAPL", 340, 336.51, 3],
  ["AMZN", 255, 262.43, 2],
  ["GOOGL", 350, 351.6, 2],
  ["META", 720, 718.38, 3],
  ["MSFT", 525, 535.08, 2],
  ["NVDA", 230, 229.34, 3],
  ["TSLA", 375, 382.75, 2],
];
const e6 = (n: number) => BigInt(Math.round(n * 1e6));
function chain(opts: { settled?: boolean; drop?: string; noBook?: string } = {}): ChainMarket[] {
  const rows: ChainMarket[] = DAY.filter(([s]) => s !== opts.drop).map(([symbol, strike, close, status]) => ({
    market: `${symbol}-mkt`,
    symbol,
    strikeE6: e6(strike),
    expiryTs: CLOSE,
    status: opts.settled ? status : 0,
    hasBook: symbol !== opts.noBook,
    settlementPriceE6: opts.settled ? e6(close) : 0n,
  }));
  // The 09:10 ET rehearsal market: another expiry, so never part of the day.
  rows.push({ market: "rehearsal", symbol: "AAPL", strikeE6: e6(340), expiryTs: 1791551408, status: 3, hasBook: false, settlementPriceE6: e6(330.94) });
  return rows;
}
const facts = (checkpoint: "create" | "settle", c: ChainMarket[], nowSec = CLOSE + 600) =>
  buildFacts({ checkpoint, dateKey: DATE, closeTs: CLOSE, nowSec, expectedSymbols: MAG7, chain: c });

/** Stub client: returns `reply` (or throws) instead of calling Claude. */
function stub(reply: string | Error): CopilotClient {
  return {
    beta: {
      messages: {
        create: async () => {
          if (reply instanceof Error) throw reply;
          return { stop_reason: "end_turn", content: [{ type: "text", text: reply }] };
        },
      },
    },
  } as unknown as CopilotClient;
}

describe("operator copilot — facts (deterministic)", () => {
  it("create: 7/7 with books is ok; the rehearsal market (other expiry) is ignored", () => {
    const f = facts("create", chain(), CLOSE - 8 * 3600);
    expect(f.ok).to.equal(true);
    expect(f.counts).to.include({ expected: 7, created: 7, withBook: 7 });
  });
  it("create: a missing market and a missing book are issues", () => {
    const f = facts("create", chain({ drop: "TSLA", noBook: "AMZN" }), CLOSE - 8 * 3600);
    expect(f.ok).to.equal(false);
    expect(f.issues).to.include("TSLA: no market for 2026-10-09");
    expect(f.issues).to.include("AMZN: market has no order book");
  });
  it("settle: the real Oct 9 day is 7/7 settled, 4 YES / 3 NO, with close prices", () => {
    const f = facts("settle", chain({ settled: true }));
    expect(f.ok).to.equal(true);
    expect(f.counts).to.include({ settledYes: 4, settledNo: 3, unsettled: 0 });
    expect(f.markets.find((m) => m.symbol === "NVDA")).to.include({ state: "settled-no", closePrice: 229.34 });
  });
  it("settle: markets still open 5 min after the close are issues", () => {
    const f = facts("settle", chain());
    expect(f.ok).to.equal(false);
    expect(f.issues).to.include("NVDA: not settled 5 min after the close");
  });
  it("settle: running before 16:05 ET is flagged, not reported as a failure per market", () => {
    const f = facts("settle", chain(), CLOSE + 60);
    expect(f.issues).to.deep.equal(["settle check ran before 16:05 ET; results may still be landing"]);
  });
});

describe("operator copilot — summary guard", () => {
  const settled = facts("settle", chain({ settled: true }));
  it("template states the counts and every market line", () => {
    const t = templateSummary(settled);
    expect(t).to.contain("✅ Settle check 2026-10-09: 7/7 settled (4 YES, 3 NO).");
    expect(t).to.contain("NVDA ≥ $230.00: NO at $229.34");
    expect(verifyNumbers(t, settled)).to.deep.equal([]);
  });
  it("verifyNumbers flags a number the facts do not contain (e.g. a computed difference)", () => {
    expect(verifyNumbers("NVDA missed by $0.66 at $229.34", settled)).to.deep.equal(["0.66"]);
  });
  it("uses the AI text when every number checks out", async () => {
    const s = await summarize(settled, { client: stub("✅ All 7 settled on 2026-10-09: 4 YES, 3 NO. NVDA ≥ $230.00: NO at $229.34.") });
    expect(s.source).to.equal("ai");
  });
  it("falls back to the template when the AI invents a number", async () => {
    const s = await summarize(settled, { client: stub("✅ 7 settled; NVDA missed by $0.66.") });
    expect(s.source).to.equal("template");
    expect(s.note).to.contain("0.66");
    expect(s.text).to.equal(templateSummary(settled));
  });
  it("falls back to the template when the AI call fails or there is no client", async () => {
    expect((await summarize(settled, { client: stub(new Error("503")) })).source).to.equal("template");
    expect((await summarize(settled, { client: null })).source).to.equal("template");
  });
});

describe("operator copilot — delivery", () => {
  it("prints always; posts to Slack only when a webhook is set; never throws", async () => {
    const lines: string[] = [];
    expect(await notify("hi", { log: (l) => lines.push(l) })).to.contain("skipped");
    const posted: string[] = [];
    const ok = await notify("hi", { slackWebhookUrl: "https://hooks.example/x", log: () => {}, fetchImpl: async (_u, i) => (posted.push(i.body), { ok: true, status: 200 }) });
    expect(ok).to.equal("slack sent");
    expect(JSON.parse(posted[0])).to.deep.equal({ text: "hi" });
    const down = await notify("hi", { slackWebhookUrl: "https://hooks.example/x", log: () => {}, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    expect(down).to.contain("failed");
    expect(lines).to.deep.equal(["hi"]);
  });
});
