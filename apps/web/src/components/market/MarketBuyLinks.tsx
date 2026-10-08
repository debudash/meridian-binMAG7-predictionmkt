"use client";

import Link from "next/link";
import type { MarketView } from "@/lib/market/types";
import type { IntentAvailabilityMap, OpenOrdersSnapshot, PositionSnapshot } from "@/lib/intents/types";
import type { LiveExposure } from "@/hooks/useWalletPositions";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import { useIntentAvailability } from "@/hooks/useIntentAvailability";
import { useTradingBlockedByBanner } from "@/components/layout/GlobalBanners";
import { shortBuyBlockedTitle } from "@/lib/intents/shortCopy";

const NO_OPEN_ORDERS: OpenOrdersSnapshot = { openBuyYesQty: 0, openBuyNoQty: 0 };

export interface MarketTradeState {
  availability: IntentAvailabilityMap;
  position: PositionSnapshot;
  buyYesOk: boolean;
  buyNoOk: boolean;
  buyYesTitle?: string;
  buyNoTitle?: string;
}

/**
 * Buy-side availability for a market on list surfaces (DLV-074). With live
 * exposure (wallet + Phoenix seat + resting orders, DLV-088/068) it runs the same rules as
 * the ticket (getIntentAvailability); without one it keeps the previous behaviour.
 */
export function useMarketTradeState(
  market: MarketView,
  livePosition?: LiveExposure | null,
): MarketTradeState {
  const { nowSec } = useChainClock();
  const tradingBlocked = useTradingBlockedByBanner();
  const cd = getCountdown(market, nowSec);
  const { availability, position, openOrders } = useIntentAvailability(
    market.marketId,
    livePosition
      ? {
          position: livePosition,
          openOrders: livePosition.openOrders ?? NO_OPEN_ORDERS,
          lifecycle: cd.state,
          lotSize: market.lotSize,
        }
      : {},
  );
  const tradeDisabled = !cd.tradingEnabled || tradingBlocked;
  const title = (side: "yes" | "no") => {
    const a = availability[side === "yes" ? "buy-yes" : "buy-no"];
    if (!a.enabled) return shortBuyBlockedTitle(side, a, position, openOrders, market.lotSize ?? 1);
    return tradeDisabled ? "Trading unavailable" : undefined;
  };
  return {
    availability,
    position,
    buyYesOk: availability["buy-yes"].enabled && !tradeDisabled,
    buyNoOk: availability["buy-no"].enabled && !tradeDisabled,
    buyYesTitle: title("yes"),
    buyNoTitle: title("no"),
  };
}

/** Buy Yes / Buy No links; blocked side uses the shared disabled style (D-022). */
export function MarketBuyLinks({
  market,
  state,
  compact = false,
}: {
  market: MarketView;
  state: MarketTradeState;
  compact?: boolean;
}) {
  const style = compact ? { padding: "0.2rem 0.5rem", fontSize: "0.78rem" } : undefined;
  const link = (side: "yes" | "no") => {
    const ok = side === "yes" ? state.buyYesOk : state.buyNoOk;
    const title = side === "yes" ? state.buyYesTitle : state.buyNoTitle;
    const label = side === "yes" ? "Buy Yes" : "Buy No";
    return (
      <Link
        className={`btn ${side === "yes" ? "btn-yes" : "btn-no"}`}
        href={`/markets/${market.marketId}?intent=buy-${side}&side=${side}`}
        aria-disabled={!ok}
        aria-label={!ok && title ? `${label} — unavailable: ${title}` : undefined}
        tabIndex={!ok ? -1 : undefined}
        title={title}
        onClick={(e) => {
          if (!ok) e.preventDefault();
        }}
        style={{ ...style, ...(!ok ? { cursor: "not-allowed" } : null) }}
        data-blocked={!ok || undefined}
      >
        {label}
      </Link>
    );
  };
  return (
    <span style={{ display: "inline-flex", gap: compact ? "0.35rem" : "0.5rem" }}>
      {link("yes")}
      {link("no")}
    </span>
  );
}

/** Row cell variant (table / ladder) — one hook per row, no RPC. */
export function MarketBuyCell({
  market,
  livePosition,
}: {
  market: MarketView;
  livePosition?: LiveExposure | null;
}) {
  const state = useMarketTradeState(market, livePosition);
  return <MarketBuyLinks market={market} state={state} compact />;
}
