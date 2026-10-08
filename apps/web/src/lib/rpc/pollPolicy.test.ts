/**
 * M4 (Reviewers, !63): client RPC load must not grow with every market on every page, and must
 * back off when public devnet RPC answers 429.
 */
import { describe, expect, it } from "vitest";
import { accountRefsFor, backoffInterval, is429, POLL_MS } from "./pollPolicy";

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
