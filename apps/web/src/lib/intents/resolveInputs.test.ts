/**
 * DLV-088 / DLV-068 — which position/orders feed the opposite-side check.
 * Live on-chain data always wins; demo only for fixture markets on localnet; while a connected
 * wallet's balances are still loading the ticket is locked instead of guessing "flat".
 */
import { describe, expect, it } from "vitest";
import { resolveAvailabilityInputs, balancesLoadingAvailability } from "./resolveInputs";

const live = { position: { yesQty: 4, noQty: 0 }, openOrders: { openBuyYesQty: 6, openBuyNoQty: 0 } };

describe("resolveAvailabilityInputs", () => {
  it("live data wins on every cluster", () => {
    for (const cluster of ["devnet", "mainnet-beta", "localnet"]) {
      const r = resolveAvailabilityInputs({ connected: true, marketId: "fixture-msft-420", cluster, live, liveLoading: false });
      expect(r).toMatchObject({ source: "live", position: live.position, openOrders: live.openOrders, loading: false });
    }
  });

  it("devnet/mainnet never use demo data, even for a fixture-looking id", () => {
    for (const cluster of ["devnet", "mainnet-beta"]) {
      const r = resolveAvailabilityInputs({ connected: true, marketId: "fixture-aapl-230-oct16", cluster, live: null, liveLoading: false });
      expect(r.source).toBe("flat");
      expect(r.position).toEqual({ yesQty: 0, noQty: 0 });
    }
  });

  it("localnet fixture market without live data → demo", () => {
    const r = resolveAvailabilityInputs({ connected: true, marketId: "fixture-aapl-230-oct16", cluster: "localnet", live: null, liveLoading: false });
    expect(r.source).toBe("demo");
    expect(r.position.yesQty).toBe(40);
  });

  it("real market, connected, first read pending → loading (ticket locked, not flat)", () => {
    const r = resolveAvailabilityInputs({ connected: true, marketId: "7hZ95hAUq6Zr9ZQJvKz3cWZ8d1kUe2nNfPq3oTzkXyW", cluster: "devnet", live: null, liveLoading: true });
    expect(r.loading).toBe(true);
  });

  it("disconnected → flat, not loading", () => {
    const r = resolveAvailabilityInputs({ connected: false, marketId: "x", cluster: "devnet", live: null, liveLoading: true });
    expect(r).toMatchObject({ source: "flat", loading: false });
  });
});

describe("balancesLoadingAvailability", () => {
  it("disables every intent with a balances-loading reason", () => {
    const a = balancesLoadingAvailability();
    for (const k of ["buy-yes", "sell-yes", "buy-no", "sell-no"] as const) {
      expect(a[k]).toMatchObject({ enabled: false, reason: "loading" });
    }
    expect(a["buy-no"].copy).toMatch(/checking your balances/i);
  });
});
