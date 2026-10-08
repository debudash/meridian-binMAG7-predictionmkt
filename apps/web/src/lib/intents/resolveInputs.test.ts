/**
 * DLV-088 / DLV-068 — which position/orders feed the opposite-side check.
 * Live on-chain data always wins; demo only for fixture markets on localnet; while a connected
 * wallet's balances are still loading the ticket is locked instead of guessing "flat".
 */
import { describe, expect, it } from "vitest";
import {
  applyBalanceLock,
  balancesErrorAvailability,
  balancesLoadingAvailability,
  resolveAvailabilityInputs,
} from "./resolveInputs";
import { getIntentAvailability } from "./getIntentAvailability";

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

/**
 * M5 (Reviewers, !63): the balances lock failed open — when the FIRST read errored, loading went
 * false with no position and the ticket fell back to "flat" (every intent enabled). It must fail
 * closed: connected + no live data + read error → locked, with a retry.
 */
describe("M5: balances lock fails closed", () => {
  const real = "7hZ95hAUq6Zr9ZQJvKz3cWZ8d1kUe2nNfPq3oTzkXyW";

  it("connected, first read errored, no data → locked (error), not flat", () => {
    const r = resolveAvailabilityInputs({ connected: true, marketId: real, cluster: "devnet", live: null, liveLoading: false, liveError: true });
    expect(r.locked).toBe("error");
    expect(r.source).not.toBe("live");
  });

  it("still pending → locked (loading)", () => {
    const r = resolveAvailabilityInputs({ connected: true, marketId: real, cluster: "devnet", live: null, liveLoading: true });
    expect(r.locked).toBe("loading");
  });

  it("live data present (even with a later poll error) → not locked", () => {
    const r = resolveAvailabilityInputs({ connected: true, marketId: real, cluster: "devnet", live, liveLoading: false, liveError: true });
    expect(r.locked).toBeNull();
    expect(r.source).toBe("live");
  });

  it("disconnected → not locked", () => {
    const r = resolveAvailabilityInputs({ connected: false, marketId: real, cluster: "devnet", live: null, liveLoading: false, liveError: true });
    expect(r.locked).toBeNull();
  });

  it("applyBalanceLock disables every intent with retry copy on error", () => {
    const flat = getIntentAvailability({ yesQty: 0, noQty: 0 }, { openBuyYesQty: 0, openBuyNoQty: 0 }, { pendingTradeCount: 0 }, { lifecycle: "open" });
    expect(flat["buy-no"].enabled).toBe(true); // what used to leak through
    const r = resolveAvailabilityInputs({ connected: true, marketId: real, cluster: "devnet", live: null, liveLoading: false, liveError: true });
    const a = applyBalanceLock(flat, r);
    for (const k of ["buy-yes", "sell-yes", "buy-no", "sell-no"] as const) {
      expect(a[k]).toMatchObject({ enabled: false, reason: "balances-error" });
    }
    expect(a["buy-yes"].copy).toMatch(/couldn.t read your balances/i);
    expect(a).toEqual(balancesErrorAvailability());
  });

  it("applyBalanceLock keeps closed-market copy", () => {
    const closed = getIntentAvailability({ yesQty: 0, noQty: 0 }, { openBuyYesQty: 0, openBuyNoQty: 0 }, { pendingTradeCount: 0 }, { lifecycle: "settled" });
    const r = resolveAvailabilityInputs({ connected: true, marketId: real, cluster: "devnet", live: null, liveLoading: false, liveError: true });
    expect(applyBalanceLock(closed, r)).toEqual(closed);
  });
});
