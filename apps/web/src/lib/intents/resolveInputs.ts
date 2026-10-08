/**
 * Inputs for the opposite-side availability check (DLV-088 / DLV-068).
 * Live on-chain (wallet + Phoenix seat + resting orders) always wins. Demo data only for fixture
 * markets in localnet fixture mode. A connected wallet whose first read hasn't landed is
 * "loading" (ticket locked) — never silently treated as flat.
 */
import { getDemoOpenOrders, getDemoPosition } from "@/lib/demo/portfolio";
import { demoMarketAllowed } from "@/lib/portfolio/demoMode";
import type { IntentAvailabilityMap, OpenOrdersSnapshot, PositionSnapshot } from "./types";

const FLAT_POSITION: PositionSnapshot = { yesQty: 0, noQty: 0 };
const NO_ORDERS: OpenOrdersSnapshot = { openBuyYesQty: 0, openBuyNoQty: 0 };

export interface ResolvedInputs {
  position: PositionSnapshot;
  openOrders: OpenOrdersSnapshot;
  source: "live" | "demo" | "flat";
  loading: boolean;
}

export function resolveAvailabilityInputs(opts: {
  connected: boolean;
  marketId: string;
  cluster: string;
  live: { position: PositionSnapshot; openOrders?: OpenOrdersSnapshot } | null | undefined;
  liveLoading: boolean;
}): ResolvedInputs {
  if (opts.live) {
    return { position: opts.live.position, openOrders: opts.live.openOrders ?? NO_ORDERS, source: "live", loading: false };
  }
  if (opts.connected && demoMarketAllowed(opts.marketId, opts.cluster)) {
    return { position: getDemoPosition(opts.marketId), openOrders: getDemoOpenOrders(opts.marketId), source: "demo", loading: false };
  }
  return { position: FLAT_POSITION, openOrders: NO_ORDERS, source: "flat", loading: opts.connected && opts.liveLoading };
}

export function balancesLoadingAvailability(): IntentAvailabilityMap {
  const d = { enabled: false, reason: "loading", copy: "Checking your balances…" };
  return { "buy-yes": d, "sell-yes": d, "buy-no": d, "sell-no": d };
}
