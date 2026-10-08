/**
 * Fixtures gating (DLV-084): sample markets are a localnet/dev convenience only.
 * On devnet / mainnet a failed or empty chain read must surface an error / empty state,
 * never fixture markets.
 */
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll, afterAll } from "vitest";

const rpc = vi.hoisted(() => ({
  fetchMarketsViaRpc: vi.fn(),
  fetchMarketViaRpc: vi.fn(),
}));
vi.mock("./rpc", () => rpc);
vi.mock("./http", () => ({
  isHttpIndexerConfigured: () => false,
  httpListMarkets: vi.fn(async () => null),
  httpGetMarket: vi.fn(async () => null),
  httpListFills: vi.fn(async () => null),
  httpPortfolioHints: vi.fn(async () => null),
}));

import { listMarkets, getMarket, resetMarketListCache } from "./index";
import { fixturesAllowed } from "@/lib/solana/config";
import { displayBook } from "@/lib/market/fixtures";

// M2: fixtures need a loopback RPC as well as a localnet-style label — these cases model local dev.
const savedRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
beforeAll(() => {
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
});
afterAll(() => {
  if (savedRpcUrl === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = savedRpcUrl;
});

const NOW = 1_791_400_000;
const saved = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
function setCluster(c: string | undefined) {
  if (c === undefined) delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  else process.env.NEXT_PUBLIC_SOLANA_CLUSTER = c;
}

beforeEach(() => {
  resetMarketListCache();
  rpc.fetchMarketsViaRpc.mockReset();
  rpc.fetchMarketViaRpc.mockReset();
});
afterEach(() => setCluster(saved));

describe("fixturesAllowed", () => {
  it("only localnet-style clusters allow fixture fallback", () => {
    for (const c of ["localnet", "localhost", "custom"]) expect(fixturesAllowed(c)).toBe(true);
    for (const c of ["devnet", "testnet", "mainnet-beta", "mainnet", ""]) expect(fixturesAllowed(c)).toBe(false);
  });
  it("defaults to the configured cluster (unset → devnet → not allowed)", () => {
    setCluster(undefined);
    expect(fixturesAllowed()).toBe(false);
    setCluster("localnet");
    expect(fixturesAllowed()).toBe(true);
  });
});

describe("listMarkets fallback gating", () => {
  it("localnet + RPC failure → fixture markets with banner (unchanged dev behaviour)", async () => {
    setCluster("localnet");
    rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await listMarkets(NOW);
    expect(r.source).toBe("fixtures");
    expect(r.usedFixtures).toBe(true);
    expect(r.markets.length).toBeGreaterThan(0);
  });

  for (const cluster of ["devnet", "mainnet-beta"]) {
    it(`${cluster} + RPC failure → no fixtures, error state`, async () => {
      setCluster(cluster);
      rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("429 Too Many Requests"));
      const r = await listMarkets(NOW);
      expect(r.usedFixtures).toBe(false);
      expect(r.source).toBe("unavailable");
      expect(r.markets).toEqual([]);
      expect(r.error).toMatch(/couldn.t load markets/i);
      expect(r.error).toContain(cluster);
    });

    it(`${cluster} + RPC empty → no fixtures, empty state (not an error)`, async () => {
      setCluster(cluster);
      rpc.fetchMarketsViaRpc.mockResolvedValue([]);
      const r = await listMarkets(NOW);
      expect(r.usedFixtures).toBe(false);
      expect(r.source).toBe("rpc-gpa");
      expect(r.markets).toEqual([]);
      expect(r.error).toBeUndefined();
      expect(r.message).toMatch(/no markets/i);
    });
  }

  it("devnet with live markets → live markets (no banner)", async () => {
    setCluster("devnet");
    rpc.fetchMarketsViaRpc.mockResolvedValue([{ marketId: "M1" }]);
    const r = await listMarkets(NOW);
    expect(r.source).toBe("rpc-gpa");
    expect(r.markets).toHaveLength(1);
    expect(r.usedFixtures).toBe(false);
  });
});

describe("getMarket fallback gating", () => {
  it("localnet: unknown id + RPC failure → fixture market by id", async () => {
    setCluster("localnet");
    rpc.fetchMarketViaRpc.mockRejectedValue(new Error("down"));
    rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("down"));
    const { buildFixtureMarkets } = await import("@/lib/market/fixtures");
    const id = buildFixtureMarkets(NOW)[0].marketId;
    const r = await getMarket(id, NOW);
    expect(r.usedFixtures).toBe(true);
    expect(r.market?.marketId).toBe(id);
  });

  it("devnet: fixture id + RPC failure → null market with error (no fixture)", async () => {
    setCluster("devnet");
    rpc.fetchMarketViaRpc.mockRejectedValue(new Error("down"));
    rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("down"));
    const { buildFixtureMarkets } = await import("@/lib/market/fixtures");
    const id = buildFixtureMarkets(NOW)[0].marketId;
    const r = await getMarket(id, NOW);
    expect(r.usedFixtures).toBe(false);
    expect(r.market).toBeNull();
    expect(r.source).toBe("unavailable");
    expect(r.error).toMatch(/couldn.t load/i);
  });

  it("mainnet: RPC reachable but market missing → null, no error (404)", async () => {
    setCluster("mainnet-beta");
    rpc.fetchMarketViaRpc.mockResolvedValue(null);
    rpc.fetchMarketsViaRpc.mockResolvedValue([]);
    const r = await getMarket("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", NOW);
    expect(r.market).toBeNull();
    expect(r.usedFixtures).toBe(false);
    expect(r.error).toBeUndefined();
  });
});

describe("displayBook", () => {
  const market: any = { yesMid: 0.5, tickSize: 0.01, minPrice: 0.01, maxPrice: 0.99 };
  it("live book wins everywhere", () => {
    const live = { bids: [{ price: 0.4, size: 1 }], asks: [], sequence: 9, updatedAt: 1 };
    expect(displayBook(live, market, false)).toBe(live);
  });
  it("no live book: fixture ladder only when fixtures allowed, else empty", () => {
    expect(displayBook(null, market, true).bids.length).toBeGreaterThan(0);
    const empty = displayBook(null, market, false);
    expect(empty.bids).toEqual([]);
    expect(empty.asks).toEqual([]);
  });
});
