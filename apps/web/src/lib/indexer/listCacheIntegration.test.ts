/**
 * M4 / L10: listMarkets and getMarket's list fallback share one cached scan, so a page view plus
 * /api/markets polls (and unknown-pubkey misses) don't each fire a full getProgramAccounts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ fetchMarketsViaRpc: vi.fn(), fetchMarketViaRpc: vi.fn() }));
vi.mock("./rpc", () => rpc);
vi.mock("./http", () => ({
  isHttpIndexerConfigured: () => false,
  httpListMarkets: vi.fn(async () => null),
  httpGetMarket: vi.fn(async () => null),
  httpListFills: vi.fn(async () => null),
  httpPortfolioHints: vi.fn(async () => null),
}));

import { getMarket, listMarkets, resetMarketListCache } from "./index";

const NOW = 1_791_400_000;
const M = { marketId: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "open" };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
  rpc.fetchMarketsViaRpc.mockReset().mockResolvedValue([M]);
  rpc.fetchMarketViaRpc.mockReset().mockResolvedValue(null);
  resetMarketListCache();
});

describe("server-side market scan cache", () => {
  it("repeat listMarkets calls inside the TTL do one GPA", async () => {
    await listMarkets(NOW);
    await listMarkets(NOW);
    await listMarkets(NOW);
    expect(rpc.fetchMarketsViaRpc).toHaveBeenCalledTimes(1);
  });
  it("getMarket misses on unknown pubkeys reuse the cached scan (L10)", async () => {
    await listMarkets(NOW);
    for (let i = 0; i < 5; i++) await getMarket("11111111111111111111111111111111", NOW);
    expect(rpc.fetchMarketsViaRpc).toHaveBeenCalledTimes(1);
  });
});
