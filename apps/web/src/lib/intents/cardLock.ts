/**
 * Market-card / list-row Buy links (Low, review dd46769): apply the same M5 balance lock as the
 * ticket. With live exposure the card runs the ticket rules; without it, a connected wallet whose
 * batched read is still pending ("loading") or failed before any data landed ("error") is locked
 * instead of being treated as flat. The ticket itself still re-checks.
 */
import type { MarketLifecycleStatus, OpenOrdersSnapshot, PositionSnapshot } from "./types";

export type BalancesLock = "loading" | "error" | null;

export function walletPositionsLock(s: {
  connected: boolean;
  hasAccount: boolean;
  loading: boolean;
  error: string | null;
}): BalancesLock {
  if (!s.connected || s.hasAccount) return null;
  if (s.error) return "error";
  return s.loading ? "loading" : null;
}

export interface CardAvailabilityOptions {
  position?: PositionSnapshot;
  openOrders?: OpenOrdersSnapshot;
  balancesLoading?: boolean;
  balancesError?: boolean;
  lifecycle?: MarketLifecycleStatus;
  lotSize?: number;
}

const NO_OPEN_ORDERS: OpenOrdersSnapshot = { openBuyYesQty: 0, openBuyNoQty: 0 };

export function cardAvailabilityOptions(
  live: (PositionSnapshot & { openOrders?: OpenOrdersSnapshot }) | null | undefined,
  lock: BalancesLock,
  lifecycle: MarketLifecycleStatus,
  lotSize: number | undefined,
): CardAvailabilityOptions {
  if (live) {
    return { position: live, openOrders: live.openOrders ?? NO_OPEN_ORDERS, lifecycle, lotSize };
  }
  return { balancesLoading: lock === "loading", balancesError: lock === "error", lifecycle, lotSize };
}
