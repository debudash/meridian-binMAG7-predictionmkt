/**
 * M4 (Reviewers, !63): client RPC load must not grow with every market on every page, and must
 * back off when public devnet RPC answers 429.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountRefsFor, backoffInterval, is429, nextSettledPhoenixDone, POLL_MS } from "./pollPolicy";

const m = (id: string, status: "open" | "settling" | "settled-yes" | "settled-no" | "void") => ({
  marketId: id,
  status,
  yesMint: `Y${id}`,
  noMint: `N${id}`,
  phoenixMarket: `P${id}`,
});
const markets = [m("a", "open"), m("b", "settled-yes"), m("c", "settled-no"), m("d", "void"), m("e", "settling")];

describe("accountRefsFor", () => {
  it("default: Phoenix reads only for open markets (settled/void/settling skip the full market-state read)", () => {
    const refs = accountRefsFor(markets);
    expect(refs).toHaveLength(5);
    expect(refs.filter((r) => r.phoenixMarket).map((r) => r.marketId)).toEqual(["a"]);
  });
  it("header redeem dot: settled markets only, no Phoenix reads at all", () => {
    const refs = accountRefsFor(markets, { scope: "redeemable" });
    expect(refs.map((r) => r.marketId)).toEqual(["b", "c"]);
    expect(refs.every((r) => r.phoenixMarket === undefined)).toBe(true);
  });
  it("portfolio keeps seat reads on settled markets (withdraw leftovers) but not on void ones", () => {
    const refs = accountRefsFor(markets, { scope: "portfolio" });
    expect(refs.filter((r) => r.phoenixMarket).map((r) => r.marketId)).toEqual(["a", "b", "c", "e"]);
  });
});

describe("poll intervals", () => {
  it("header/trade/history polls are slower than the pre-M4 30s/4s/30s", () => {
    expect(POLL_MS.headerAccount).toBeGreaterThanOrEqual(60_000);
    expect(POLL_MS.tradeAccount).toBeGreaterThanOrEqual(10_000);
    expect(POLL_MS.tradeBook).toBeGreaterThan(4_000);
    expect(POLL_MS.history).toBeGreaterThanOrEqual(60_000);
    expect(POLL_MS.marketList).toBeGreaterThanOrEqual(60_000);
  });
});

describe("429 backoff", () => {
  it("detects rate limiting from web3.js / fetch error text", () => {
    expect(is429(new Error("429 Too Many Requests"))).toBe(true);
    expect(is429(new Error('Server responded with 429 Too Many Requests.  Retrying after 500ms delay...'))).toBe(true);
    expect(is429("HTTP 429")).toBe(true);
    expect(is429(new Error("fetch failed"))).toBe(false);
    expect(is429(null)).toBe(false);
  });
  it("doubles the interval per consecutive 429 failure, capped at 5 min; normal errors keep the base", () => {
    expect(backoffInterval(10_000, null, 0)).toBe(10_000);
    expect(backoffInterval(10_000, new Error("fetch failed"), 3)).toBe(10_000);
    expect(backoffInterval(10_000, new Error("429"), 1)).toBe(20_000);
    expect(backoffInterval(10_000, new Error("429"), 2)).toBe(40_000);
    expect(backoffInterval(10_000, new Error("429"), 20)).toBe(300_000);
  });
});

describe("Portfolio: stop re-reading settled Phoenix books once the wallet's seat there is empty (Low, review dd46769)", () => {
  const empty = { phoenixMarket: "P", seat: { yesFree: 0, yesLocked: 0, usdcFree: 0, usdcLocked: 0 }, orders: [] };
  const leftovers = { ...empty, seat: { ...empty.seat, usdcFree: 1.5 } };
  const resting = { ...empty, orders: [{ orderSequenceNumber: "1", side: "bid", price: 0.4, size: 1 }] };
  const state = (marketId: string, phoenix: unknown) => ({ marketId, wallet: { yes: 0, no: 0 }, phoenix });

  it("portfolio scope skips Phoenix for settled markets listed in settledPhoenixDone, keeps open/settling ones", () => {
    const refs = accountRefsFor(markets, { scope: "portfolio", settledPhoenixDone: new Set(["b", "e", "a"]) });
    expect(refs).toHaveLength(5); // ATAs still read for every market (redeem)
    expect(refs.filter((r) => r.phoenixMarket).map((r) => r.marketId)).toEqual(["a", "c", "e"]);
  });

  it("marks settled markets whose seat read came back empty (or no seat); keeps polling leftovers and resting orders", () => {
    const acct = new Map([
      ["a", state("a", empty)], // open: never marked
      ["b", state("b", empty)], // settled, empty seat → done
      ["c", state("c", leftovers)], // settled, withdrawable USDC → keep reading
      ["e", state("e", null)], // settling: never marked
    ]);
    const settledWithOrders = [...markets, m("f", "settled-no"), m("g", "settled-yes")];
    acct.set("f", state("f", resting));
    acct.set("g", state("g", null)); // no seat at all → done
    const next = nextSettledPhoenixDone(new Set(), settledWithOrders, acct as never);
    expect([...next].sort()).toEqual(["b", "g"]);
  });

  it("returns the same Set instance when nothing changes (no extra re-render / query-key churn)", () => {
    const prev = new Set(["b"]);
    const acct = new Map([["b", state("b", null)], ["c", state("c", leftovers)]]);
    expect(nextSettledPhoenixDone(prev, markets, acct as never)).toBe(prev);
  });

  it("never marks a settled market the read didn't cover (no entry yet, e.g. list refreshed before the next read)", () => {
    const acct = new Map([["b", state("b", leftovers)]]);
    const next = nextSettledPhoenixDone(new Set(), markets, acct as never);
    expect([...next]).toEqual([]); // 'c' absent from the read → still polled
  });
});

describe("order-book footer matches the real book poll (Reviewer nit)", () => {
  const src = (p: string) => readFileSync(path.join(__dirname, "../..", p), "utf8");

  it("copy is derived from POLL_MS.tradeBook (6s today)", async () => {
    const { liveBookFooter } = await import("./pollPolicy");
    expect(liveBookFooter()).toBe(`Live Phoenix V1 book (Yes/USDC) — refreshes every ${POLL_MS.tradeBook / 1000}s.`);
    expect(liveBookFooter()).toBe("Live Phoenix V1 book (Yes/USDC) — refreshes every 6s.");
    expect(liveBookFooter(2_500)).toBe("Live Phoenix V1 book (Yes/USDC) — refreshes every 2.5s.");
  });
  it("OrderBook renders that copy (no hard-coded interval) and TradeClient polls on the same constant", () => {
    const book = src("components/trade/OrderBook.tsx");
    expect(book).toMatch(/liveBookFooter\(\)/);
    expect(book).not.toMatch(/refreshes every \d/);
    expect(src("app/markets/[marketId]/TradeClient.tsx")).toMatch(/\}, POLL_MS\.tradeBook\)/);
  });
});
