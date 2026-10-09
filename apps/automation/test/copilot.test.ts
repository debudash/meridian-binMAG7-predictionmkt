import { expect } from "chai";
import { buildFacts, fromAnchorAccount, type ChainMarket } from "../src/copilot/facts";
import { composeMessage, promptFacts, summarize, templateHeadline, verifyHeadline, type CopilotClient } from "../src/copilot/summarize";
import { notify } from "../src/copilot/notify";

// Fixture = the real 2026-10-09 devnet day (TEST_RESULTS §8): 7 MAG7 markets (1 operator strike each), all settled by
// the Pyth pull oracle.
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
function chain(opts: { settled?: boolean; drop?: string; noBook?: string; strikesPer?: number } = {}): ChainMarket[] {
  const offsets = opts.strikesPer === 3 ? [-5, 0, 5] : [0];
  const rows: ChainMarket[] = [];
  for (const [symbol, strike, close, status] of DAY) {
    if (symbol === opts.drop) continue;
    for (const off of offsets)
      rows.push({
        market: `${symbol}${off}`,
        symbol,
        strikeE6: e6(strike + off),
        expiryTs: CLOSE,
        status: opts.settled ? status : 0,
        hasBook: symbol !== opts.noBook,
        settlementPriceE6: opts.settled ? e6(close) : 0n,
      });
  }
  // The 09:10 ET rehearsal market: another expiry, so never part of the day.
  rows.push({ market: "rehearsal", symbol: "AAPL", strikeE6: e6(340), expiryTs: 1791551408, status: 3, hasBook: false, settlementPriceE6: e6(330.94) });
  return rows;
}
const facts = (checkpoint: "create" | "settle", c: ChainMarket[], o: { nowSec?: number; perSymbol?: number } = {}) =>
  buildFacts({ checkpoint, dateKey: DATE, closeTs: CLOSE, nowSec: o.nowSec ?? CLOSE + 600, expectedSymbols: MAG7, perSymbol: o.perSymbol ?? 1, chain: c });
const AT_0805 = CLOSE - 8 * 3600 + 300;

/** Stub client: returns `reply` with `stop` (or throws) instead of calling Claude; records the request. */
function stub(reply: string | Error, stop = "end_turn", seen: any[] = []): CopilotClient {
  return {
    beta: {
      messages: {
        create: async (req: any) => {
          seen.push(req);
          if (reply instanceof Error) throw reply;
          return { stop_reason: stop, content: [{ type: "text", text: reply }] };
        },
      },
    },
  } as unknown as CopilotClient;
}

describe("operator copilot — facts (deterministic)", () => {
  it("create: 7/7 with books is ok; the rehearsal market (other expiry) is ignored", () => {
    const f = facts("create", chain(), { nowSec: AT_0805 });
    expect(f.ok).to.equal(true);
    expect(f.counts).to.include({ expected: 7, created: 7, withBook: 7 });
  });
  it("create: a worker day with 3 strikes per symbol is ok with perSymbol 3 (21 markets)", () => {
    const f = facts("create", chain({ strikesPer: 3 }), { nowSec: AT_0805, perSymbol: 3 });
    expect(f.ok).to.equal(true);
    expect(f.counts).to.include({ expected: 21, created: 21 });
    expect(facts("create", chain(), { nowSec: AT_0805, perSymbol: 3 }).issues).to.include("AAPL: 1 markets for 2026-10-09 (expected 3)");
  });
  it("create: a missing market, a missing book and a run before 08:00 are issues", () => {
    const f = facts("create", chain({ drop: "TSLA", noBook: "AMZN" }), { nowSec: CLOSE - 9 * 3600 });
    expect(f.ok).to.equal(false);
    expect(f.issues).to.include.members([
      "TSLA: no market for 2026-10-09",
      "AMZN ≥ $255.00: no order book",
      "create check ran before 08:00 ET; markets may still be coming",
    ]);
  });
  it("unknown status and markets outside STRIKE_SYMBOLS are issues, not silently counted", () => {
    const c = chain({ settled: true });
    c[0].status = 9;
    c.push({ market: "x", symbol: "NFLX", strikeE6: e6(700), expiryTs: CLOSE, status: 0, hasBook: true, settlementPriceE6: 0n });
    const f = facts("settle", c);
    expect(f.issues).to.include("AAPL ≥ $340.00: unknown on-chain status");
    expect(f.issues).to.include("NFLX: unexpected market for 2026-10-09 (not in STRIKE_SYMBOLS)");
    expect(f.counts.created).to.equal(7);
  });
  it("settle: the real Oct 9 day is 7/7 settled, 4 YES / 3 NO, with close prices", () => {
    const f = facts("settle", chain({ settled: true }));
    expect(f.ok).to.equal(true);
    expect(f.counts).to.include({ settledYes: 4, settledNo: 3, unsettled: 0 });
    expect(f.markets.find((m) => m.symbol === "NVDA")).to.include({ state: "settled-no", closePrice: 229.34 });
  });
  it("settle: markets still open 5 min after the close are issues; before 16:05 only the timing is flagged", () => {
    expect(facts("settle", chain()).issues).to.include("NVDA ≥ $230.00: not settled 5 min after the close");
    expect(facts("settle", chain(), { nowSec: CLOSE + 60 }).issues).to.deep.equal(["settle check ran before 16:05 ET; results may still be landing"]);
  });
  it("fromAnchorAccount maps a decoded account (symbol padding, BN-like numbers, default Phoenix key = no book)", () => {
    const pk = (s: string) => ({ toBase58: () => s });
    const num = (s: string) => ({ toString: () => s });
    const m = fromAnchorAccount({
      publicKey: pk("5RFm"),
      account: { equitySymbol: Buffer.from("AAPL    "), strikePriceE6: num("340000000"), expiryTs: num(String(CLOSE)), status: 3, phoenixMarket: pk("11111111111111111111111111111111"), settlementPriceE6: num("336510000") },
    });
    expect(m).to.deep.equal({ market: "5RFm", symbol: "AAPL", strikeE6: 340000000n, expiryTs: CLOSE, status: 3, hasBook: false, settlementPriceE6: 336510000n });
  });
});

describe("operator copilot — message and headline guard", () => {
  const settled = facts("settle", chain({ settled: true }));
  const broken = facts("settle", chain({ settled: true, noBook: "TSLA" }));
  it("code writes the mark, issues, runbook pointer and every market line", () => {
    const t = composeMessage(settled);
    expect(t.split("\n")[0]).to.equal("✅ Settle check 2026-10-09: 7/7 settled (4 YES, 3 NO).");
    expect(t).to.contain("NVDA ≥ $230.00: NO at $229.34");
    const b = composeMessage(broken, "TSLA has no book.");
    expect(b.split("\n")[0]).to.equal("⚠️ TSLA has no book.");
    expect(b).to.contain("• TSLA ≥ $375.00: no order book");
    expect(b).to.contain("Action needed: see docs/DEPLOY.md §6.");
  });
  it("Claude sees no market addresses or timestamps", () => {
    const p = JSON.stringify(promptFacts(settled));
    expect(p).to.not.contain("AAPL0");
    expect(p).to.not.contain(String(CLOSE));
  });
  it("verifyHeadline accepts a faithful headline", () => {
    expect(verifyHeadline("All 7 markets settled on 2026-10-09 by 16:05 ET: 4 YES, 3 NO.", settled)).to.deep.equal([]);
  });
  it("verifyHeadline rejects invented numbers, percentages, number words, wrong YES/NO counts and all-clear with issues", () => {
    expect(verifyHeadline("NVDA missed by 0.66.", settled)[0]).to.contain("0.66");
    expect(verifyHeadline("MSFT up 2% today.", settled)).to.include("percentage");
    expect(verifyHeadline("Seven of seven settled.", settled)[0]).to.contain("spelled-out");
    expect(verifyHeadline("7 settled: 3 YES, 4 NO.", settled).join()).to.contain('"3 YES" but the facts say 4');
    expect(verifyHeadline("All good, nothing to do.", broken).join()).to.contain("all-clear");
    expect(verifyHeadline("x".repeat(301), settled).join()).to.contain("longer");
  });
  it("uses the AI headline when it passes, with the code-written lines below it", async () => {
    const seen: any[] = [];
    const s = await summarize(settled, { client: stub("✅ All 7 settled by 16:05 ET: 4 YES, 3 NO.", "end_turn", seen) });
    expect(s.source).to.equal("ai");
    expect(s.text.split("\n")[0]).to.equal("✅ All 7 settled by 16:05 ET: 4 YES, 3 NO.");
    expect(s.text).to.contain("TSLA ≥ $375.00: YES at $382.75");
    expect(seen[0]).to.include({ model: "claude-opus-5-5", fallbacks: "default" });
    expect(seen[0].betas).to.deep.equal(["server-side-fallback-2026-07-01"]);
  });
  it("falls back to the code headline on a rejected headline, refusal, truncation, API error or no client", async () => {
    const bad = await summarize(settled, { client: stub("NVDA missed by 0.66.") });
    expect(bad.source).to.equal("template");
    expect(bad.text).to.equal(composeMessage(settled));
    expect((await summarize(settled, { client: stub("ok", "refusal") })).note).to.contain("refusal");
    expect((await summarize(settled, { client: stub("All 7 sett", "max_tokens") })).note).to.contain("max_tokens");
    expect((await summarize(settled, { client: stub(new Error("503")) })).source).to.equal("template");
    expect((await summarize(settled, { client: null })).source).to.equal("template");
    expect(templateHeadline(settled)).to.equal("Settle check 2026-10-09: 7/7 settled (4 YES, 3 NO).");
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
    expect(lines).to.deep.equal(["hi"]);
  });
  it("never echoes the webhook URL, even when it is malformed or the request throws", async () => {
    const secret = "https://hooks.slack.com/services/T000/B000/SECRETSECRET";
    const outs = [
      await notify("hi", { slackWebhookUrl: `"${secret}"`, log: () => {} }),
      await notify("hi", { slackWebhookUrl: "hooks.slack.com/services/T000/B000/SECRETSECRET", log: () => {} }),
      await notify("hi", { slackWebhookUrl: secret, log: () => {}, fetchImpl: async () => { throw new TypeError(`Failed to parse URL from ${secret}`); } }),
    ];
    for (const o of outs) {
      expect(o).to.contain("failed");
      expect(o).to.not.contain("SECRET");
    }
  });
});
