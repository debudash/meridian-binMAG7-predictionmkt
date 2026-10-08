/**
 * DLV-088 — client surfaces (Header redeem dot, Portfolio, History) get the market list from
 * the same server indexer as the pages (fixtures only on localnet, DLV-084).
 */
import { describe, expect, it, vi } from "vitest";

const indexer = vi.hoisted(() => ({ listMarkets: vi.fn() }));
vi.mock("@/lib/indexer", () => indexer);
import { GET } from "./route";

describe("GET /api/markets", () => {
  it("returns the indexer result with no-store caching", async () => {
    indexer.listMarkets.mockResolvedValue({ markets: [{ marketId: "M1" }], source: "rpc-gpa", usedFixtures: false });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ markets: [{ marketId: "M1" }], source: "rpc-gpa", usedFixtures: false });
  });

  it("unavailable (RPC down off-localnet) → 503 with the error, never fixtures", async () => {
    indexer.listMarkets.mockResolvedValue({ markets: [], source: "unavailable", usedFixtures: false, error: "down" });
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("down");
  });
});
