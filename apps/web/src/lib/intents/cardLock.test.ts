/**
 * Low (review dd46769): market-card Buy links must apply the same M5 balance lock as the ticket.
 * A connected wallet whose batched read is pending or failed must never be shown as "flat".
 */
import { describe, expect, it } from "vitest";
import { cardAvailabilityOptions, walletPositionsLock } from "./cardLock";
import { applyBalanceLock, BALANCES_ERROR_COPY, resolveAvailabilityInputs } from "./resolveInputs";
import { getIntentAvailability } from "./getIntentAvailability";

function cardAvailability(opts: ReturnType<typeof cardAvailabilityOptions>, connected = true) {
  const resolved = resolveAvailabilityInputs({
    connected,
    marketId: "AAPL-300",
    cluster: "devnet",
    live: opts.position ? { position: opts.position, openOrders: opts.openOrders } : null,
    liveLoading: opts.balancesLoading ?? false,
    liveError: opts.balancesError ?? false,
  });
  const a = getIntentAvailability(resolved.position, resolved.openOrders, { pendingTradeCount: 0 }, {
    lifecycle: opts.lifecycle ?? "open",
    lotSize: opts.lotSize ?? 1,
  });
  return applyBalanceLock(a, resolved);
}

describe("walletPositionsLock", () => {
  it("disconnected → no lock", () => {
    expect(walletPositionsLock({ connected: false, hasAccount: false, loading: false, error: null })).toBeNull();
  });
  it("connected, first read pending → loading", () => {
    expect(walletPositionsLock({ connected: true, hasAccount: false, loading: true, error: null })).toBe("loading");
  });
  it("connected, read failed with no data → error (M5 fail closed)", () => {
    expect(walletPositionsLock({ connected: true, hasAccount: false, loading: false, error: "429" })).toBe("error");
  });
  it("a later failure keeps the last good read → no lock", () => {
    expect(walletPositionsLock({ connected: true, hasAccount: true, loading: false, error: "429" })).toBeNull();
  });
});

describe("cardAvailabilityOptions → card Buy links", () => {
  it("read failed: every intent locked with the M5 retry copy (was: enabled as if flat)", () => {
    const a = cardAvailability(cardAvailabilityOptions(undefined, "error", "open", 1));
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-yes"].copy).toBe(BALANCES_ERROR_COPY);
  });
  it("read pending: locked with 'Checking your balances…'", () => {
    const a = cardAvailability(cardAvailabilityOptions(null, "loading", "open", 1));
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].reason).toBe("loading");
  });
  it("live exposure wins over a lock and runs the ticket rules", () => {
    const live = { yesQty: 2, noQty: 0, openOrders: { openBuyYesQty: 0, openBuyNoQty: 0 } };
    const a = cardAvailability(cardAvailabilityOptions(live, "error", "open", 1));
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["buy-no"].enabled).toBe(false); // holding Yes blocks Buy No
  });
  it("disconnected / no lock: unchanged behaviour (enabled)", () => {
    const a = cardAvailability(cardAvailabilityOptions(undefined, null, "open", 1), false);
    expect(a["buy-yes"].enabled).toBe(true);
  });
});
