/**
 * Shared intent-availability hook — docs/ui/07.
 * Wraps pure getIntentAvailability + position / orders / pending state.
 * Inputs: live on-chain (wallet + Phoenix seat + resting orders) when given; demo only for
 * fixture markets in localnet fixture mode (DLV-088); "loading" locks intents while a connected
 * wallet's first read is pending.
 */
"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  getIntentAvailability,
  getExposure,
} from "@/lib/intents/getIntentAvailability";
import { applyBalanceLock, resolveAvailabilityInputs } from "@/lib/intents/resolveInputs";
import type {
  IntentAvailabilityMap,
  MarketLifecycleStatus,
  OpenOrdersSnapshot,
  PendingTxSnapshot,
  PositionSnapshot,
} from "@/lib/intents/types";
import { getCountdown } from "@/lib/market/countdown";
import { getMarketById } from "@/lib/market/fixtures";
import { getCluster } from "@/lib/solana/config";
import { useChainClock } from "@/components/providers/AppProviders";

export interface UseIntentAvailabilityOptions {
  /** Live on-chain position (wallet + seat). */
  position?: PositionSnapshot;
  /** Live resting orders (resting buys count toward the opposite-side block). */
  openOrders?: OpenOrdersSnapshot;
  pendingTxs?: PendingTxSnapshot;
  /** Connected wallet's first live read hasn't landed yet → lock intents. */
  balancesLoading?: boolean;
  /** The wallet read errored before any data landed → stay locked (M5, fail closed). */
  balancesError?: boolean;
  lotSize?: number;
  lifecycle?: MarketLifecycleStatus;
}

export interface UseIntentAvailabilityResult {
  availability: IntentAvailabilityMap;
  position: PositionSnapshot;
  openOrders: OpenOrdersSnapshot;
  pendingTxs: PendingTxSnapshot;
  lifecycle: MarketLifecycleStatus;
  exposure: ReturnType<typeof getExposure>;
  source: "live" | "demo" | "flat";
  /** Why intents are locked (balances pending / read failed), or null */
  locked: "loading" | "error" | null;
}

export function useIntentAvailability(
  marketId: string,
  opts: UseIntentAvailabilityOptions = {},
): UseIntentAvailabilityResult {
  const { connected } = useWallet();
  const { nowSec } = useChainClock();
  const market = getMarketById(marketId, nowSec);
  const cd = market ? getCountdown(market, nowSec) : null;

  const resolved = useMemo(
    () =>
      resolveAvailabilityInputs({
        connected,
        marketId,
        cluster: getCluster(),
        live: opts.position ? { position: opts.position, openOrders: opts.openOrders } : null,
        liveLoading: opts.balancesLoading ?? false,
        liveError: opts.balancesError ?? false,
      }),
    [connected, marketId, opts.position, opts.openOrders, opts.balancesLoading, opts.balancesError],
  );
  const { position, openOrders } = resolved;

  const pendingTxs = useMemo<PendingTxSnapshot>(
    () => opts.pendingTxs ?? { pendingTradeCount: 0 },
    [opts.pendingTxs],
  );

  const lifecycle: MarketLifecycleStatus =
    opts.lifecycle ?? cd?.state ?? "open";
  const lotSize = opts.lotSize ?? market?.lotSize ?? 1;

  const availability = useMemo(() => {
    const a = getIntentAvailability(position, openOrders, pendingTxs, { lifecycle, lotSize });
    // Closed markets keep their own copy; otherwise never guess "flat" while balances load or
    // after the first read failed (M5: fail closed).
    return applyBalanceLock(a, resolved);
  }, [position, openOrders, pendingTxs, lifecycle, lotSize, resolved]);

  const exposure = useMemo(
    () => getExposure(position, openOrders, lotSize),
    [position, openOrders, lotSize],
  );

  return {
    availability,
    position,
    openOrders,
    pendingTxs,
    lifecycle,
    exposure,
    source: resolved.source,
    locked: resolved.locked,
  };
}
