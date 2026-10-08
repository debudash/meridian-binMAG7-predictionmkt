/** Localnet fixture-mode demo portfolio keeps the real Portfolio shape (DLV-088). */
import { describe, expect, it } from "vitest";
import { buildFixtureMarkets } from "@/lib/market/fixtures";
import { buildDemoPortfolio } from "./portfolio";

describe("buildDemoPortfolio", () => {
  const p = buildDemoPortfolio(buildFixtureMarkets(1_791_400_000));
  it("positions/orders/redeemable reference fixture markets only", () => {
    expect(p.positions.length).toBeGreaterThan(0);
    for (const r of [...p.positions.map((x) => x.market.marketId), ...p.orders.map((o) => o.market.marketId), ...p.redeemable.map((r) => r.marketId)]) {
      expect(r.startsWith("fixture-")).toBe(true);
    }
  });
  it("demo redeem rows carry no on-chain accounts (RedeemButton explains instead of sending)", () => {
    for (const r of p.redeemable) expect(r.strikeMarket).toBeUndefined();
  });
});
