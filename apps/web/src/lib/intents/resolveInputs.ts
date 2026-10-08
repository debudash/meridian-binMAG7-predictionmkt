/**
 * Inputs for the opposite-side availability check (DLV-088 / DLV-068).
 * Live on-chain (wallet + Phoenix seat + resting orders) always wins. Demo data only for fixture
 * markets in localnet fixture mode. A connected wallet whose first read hasn't landed is
 * "loading" (ticket locked) — never silently treated as flat. M5: a connected wallet whose read
 * FAILED before any data landed is locked too ("error", with a retry) — the lock fails closed.
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
  /** Ticket must stay locked: first read pending, or it errored with no data yet (M5). */
  locked: "loading" | "error" | null;
}

export function resolveAvailabilityInputs(opts: {
  connected: boolean;
  marketId: string;
  cluster: string;
  live: { position: PositionSnapshot; openOrders?: OpenOrdersSnapshot } | null | undefined;
  liveLoading: boolean;
  /** The wallet read errored (react-query error state) */
  liveError?: boolean;
}): ResolvedInputs {
  if (opts.live) {
    return { position: opts.live.position, openOrders: opts.live.openOrders ?? NO_ORDERS, source: "live", loading: false, locked: null };
  }
  if (opts.connected && demoMarketAllowed(opts.marketId, opts.cluster)) {
    return { position: getDemoPosition(opts.marketId), openOrders: getDemoOpenOrders(opts.marketId), source: "demo", loading: false, locked: null };
  }
  const loading = opts.connected && opts.liveLoading;
  const locked = !opts.connected ? null : opts.liveError ? "error" : loading ? "loading" : null;
  return { position: FLAT_POSITION, openOrders: NO_ORDERS, source: "flat", loading, locked };
}

export function balancesLoadingAvailability(): IntentAvailabilityMap {
  const d = { enabled: false, reason: "loading", copy: "Checking your balances…" };
  return { "buy-yes": d, "sell-yes": d, "buy-no": d, "sell-no": d };
}

export const BALANCES_ERROR_COPY = "Couldn't read your balances. Retrying…";

/** M5: the balance read failed before any data landed — every intent locked, with retry copy. */
export function balancesErrorAvailability(): IntentAvailabilityMap {
  const d = { enabled: false, reason: "balances-error", copy: BALANCES_ERROR_COPY };
  return { "buy-yes": d, "sell-yes": d, "buy-no": d, "sell-no": d };
}

/** Final availability: closed markets keep their own copy; otherwise a lock wins over "flat". */
export function applyBalanceLock(a: IntentAvailabilityMap, resolved: Pick<ResolvedInputs, "locked">): IntentAvailabilityMap {
  if (!resolved.locked || a["buy-yes"].reason === "market-closed") return a;
  return resolved.locked === "error" ? balancesErrorAvailability() : balancesLoadingAvailability();
}
