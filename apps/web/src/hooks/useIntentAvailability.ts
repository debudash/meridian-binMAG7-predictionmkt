/**
 * Shared intent-availability hook — docs/ui/07.
 * Wraps pure getIntentAvailability + position / orders / pending state.
 */
"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  getIntentAvailability,
  getExposure,
} from "@/lib/intents/getIntentAvailability";
import type {
  IntentAvailabilityMap,
  MarketLifecycleStatus,
  OpenOrdersSnapshot,
  PendingTxSnapshot,
  PositionSnapshot,
} from "@/lib/intents/types";
import { getCountdown } from "@/lib/market/countdown";
import { getMarketById } from "@/lib/market/fixtures";
import {
  getDemoOpenOrders,
  getDemoPosition,
} from "@/lib/demo/portfolio";
import { useChainClock } from "@/components/providers/AppProviders";

export interface UseIntentAvailabilityOptions {
  /** Override fixture/demo position (e.g. live balances later). */
  position?: PositionSnapshot;
  openOrders?: OpenOrdersSnapshot;
  pendingTxs?: PendingTxSnapshot;
  /** When false, treat as flat (disconnected). Default: use demo when connected. */
  useDemoWhenConnected?: boolean;
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
}

export function useIntentAvailability(
  marketId: string,
  opts: UseIntentAvailabilityOptions = {},
): UseIntentAvailabilityResult {
  const { connected } = useWallet();
  const { nowSec } = useChainClock();
  const market = getMarketById(marketId, nowSec);
  const cd = market ? getCountdown(market, nowSec) : null;

  const useDemo = opts.useDemoWhenConnected !== false && connected;

  const position = useMemo<PositionSnapshot>(() => {
    if (opts.position) return opts.position;
    return useDemo ? getDemoPosition(marketId) : { yesQty: 0, noQty: 0 };
  }, [opts.position, useDemo, marketId]);

  const openOrders = useMemo<OpenOrdersSnapshot>(() => {
    if (opts.openOrders) return opts.openOrders;
    return useDemo
      ? getDemoOpenOrders(marketId)
      : { openBuyYesQty: 0, openBuyNoQty: 0 };
  }, [opts.openOrders, useDemo, marketId]);

  const pendingTxs = useMemo<PendingTxSnapshot>(
    () => opts.pendingTxs ?? { pendingTradeCount: 0 },
    [opts.pendingTxs],
  );

  const lifecycle: MarketLifecycleStatus =
    opts.lifecycle ?? cd?.state ?? "open";
  const lotSize = opts.lotSize ?? market?.lotSize ?? 1;

  const availability = useMemo(
    () =>
      getIntentAvailability(position, openOrders, pendingTxs, {
        lifecycle,
        lotSize,
      }),
    [position, openOrders, pendingTxs, lifecycle, lotSize],
  );

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
  };
}
