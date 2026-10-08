/**
 * DLV-090 — indexer reads log their failures instead of silently falling back.
 * Under load two localnet prod builds served fixture markets with nothing in the server log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { listMarkets, getMarket } from "./index";
import { __resetChainReadLogForTests } from "@/lib/log/chainRead";

const NOW = 1_791_400_000;
const saved = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetChainReadLogForTests();
  rpc.fetchMarketsViaRpc.mockReset();
  rpc.fetchMarketViaRpc.mockReset();
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  err.mockRestore();
  warn.mockRestore();
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  else process.env.NEXT_PUBLIC_SOLANA_CLUSTER = saved;
});

const logged = () => [...err.mock.calls, ...warn.mock.calls].map((c) => String(c[0])).join("\n");

describe("listMarkets logs live-read failures", () => {
  it("localnet: RPC failure is logged with its cause even though fixtures are served", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:8899"));
    const r = await listMarkets(NOW);
    expect(r.usedFixtures).toBe(true);
    expect(logged()).toContain("[chain-read]");
    expect(logged()).toContain("ECONNREFUSED 127.0.0.1:8899");
    expect(logged()).toMatch(/fixture/i);
  });

  it("devnet: RPC failure is logged (error state, no fixtures)", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    rpc.fetchMarketsViaRpc.mockRejectedValue(new Error("429 Too Many Requests"));
    const r = await listMarkets(NOW);
    expect(r.source).toBe("unavailable");
    expect(logged()).toContain("429 Too Many Requests");
  });

  it("a successful read logs nothing", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    rpc.fetchMarketsViaRpc.mockResolvedValue([{ marketId: "M1" }]);
    await listMarkets(NOW);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getMarket logs live-read failures", () => {
  it("single-market RPC failure is logged with the market id", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    rpc.fetchMarketViaRpc.mockRejectedValue(new Error("fetch failed"));
    rpc.fetchMarketsViaRpc.mockResolvedValue([]);
    const id = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
    await getMarket(id, NOW);
    expect(logged()).toContain("fetch failed");
    expect(logged()).toContain(id);
  });

  it("market simply missing (null) is not an error and logs nothing", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    rpc.fetchMarketViaRpc.mockResolvedValue(null);
    rpc.fetchMarketsViaRpc.mockResolvedValue([]);
    await getMarket("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", NOW);
    expect(err).not.toHaveBeenCalled();
  });
});
