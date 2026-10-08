"use client";

import Link from "next/link";
import type { MarketView } from "@/lib/market/types";
import type { IntentAvailabilityMap, PositionSnapshot } from "@/lib/intents/types";
import type { LiveExposure } from "@/hooks/useWalletPositions";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import { useIntentAvailability } from "@/hooks/useIntentAvailability";
import { useTradingBlockedByBanner } from "@/components/layout/GlobalBanners";
import { shortBuyBlockedTitle } from "@/lib/intents/shortCopy";
import { cardAvailabilityOptions, type BalancesLock } from "@/lib/intents/cardLock";
import { buyButtonPrices, marketPriceDisplay } from "@/lib/market/priceDisplay";

export interface MarketTradeState {
  availability: IntentAvailabilityMap;
  position: PositionSnapshot;
  buyYesOk: boolean;
  buyNoOk: boolean;
  buyYesTitle?: string;
  buyNoTitle?: string;
  /** Countdown says trading is open (closed / settled → no executable prices, DLV-116). */
  tradingOpen: boolean;
}

/**
 * Buy-side availability for a market on list surfaces (DLV-074). With live
 * exposure (wallet + Phoenix seat + resting orders, DLV-088/068) it runs the same rules as
 * the ticket (getIntentAvailability); without one, a connected wallet whose read is pending or
 * failed is locked like the ticket (M5); disconnected keeps the previous behaviour.
 */
export function useMarketTradeState(
  market: MarketView,
  livePosition?: LiveExposure | null,
  balancesLock: BalancesLock = null,
): MarketTradeState {
  const { nowSec } = useChainClock();
  const tradingBlocked = useTradingBlockedByBanner();
  const cd = getCountdown(market, nowSec);
  const { availability, position, openOrders } = useIntentAvailability(
    market.marketId,
    cardAvailabilityOptions(livePosition, balancesLock, cd.state, market.lotSize),
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
    tradingOpen: cd.tradingEnabled,
  };
}

/**
 * Buy Yes / Buy No links; blocked side uses the shared disabled style (D-022).
 * DLV-116 (docs/ui/08): each shows its EXECUTABLE price (Buy Yes = best Yes ask, Buy No = 1 − best Yes bid);
 * an empty side shows — and stays enabled for a limit order, with a no-liquidity tooltip.
 */
export function MarketBuyLinks({
  market,
  state,
  compact = false,
}: {
  market: MarketView;
  state: MarketTradeState;
  compact?: boolean;
}) {
  // Price adds width: slightly tighter horizontal padding so both fit a 4-up card row (DLV-116).
  const style = compact ? { padding: "0.2rem 0.5rem", fontSize: "0.78rem" } : { padding: "0.55rem 0.65rem" };
  const display = marketPriceDisplay(market, { open: state.tradingOpen });
  const prices = buyButtonPrices(display);
  const link = (side: "yes" | "no") => {
    const ok = side === "yes" ? state.buyYesOk : state.buyNoOk;
    const title = side === "yes" ? state.buyYesTitle : state.buyNoTitle;
    const label = side === "yes" ? "Buy Yes" : "Buy No";
    const cell = side === "yes" ? prices.yes : prices.no;
    return (
      <Link
        className={`btn ${side === "yes" ? "btn-yes" : "btn-no"}`}
        href={`/markets/${market.marketId}?intent=buy-${side}&side=${side}`}
        aria-disabled={!ok}
        aria-label={!ok && title ? `${label} — unavailable: ${title}` : undefined}
        tabIndex={!ok ? -1 : undefined}
        title={title ?? cell.title}
        onClick={(e) => {
          if (!ok) e.preventDefault();
        }}
        style={{ whiteSpace: "nowrap", ...style, ...(!ok ? { cursor: "not-allowed" } : null) }}
        data-blocked={!ok || undefined}
      >
        {label}
        {display.open && (
          <span className="tabular" data-testid={`buy-${side}-price`}>
            {cell.price}
          </span>
        )}
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
  balancesLock = null,
}: {
  market: MarketView;
  livePosition?: LiveExposure | null;
  balancesLock?: BalancesLock;
}) {
  const state = useMarketTradeState(market, livePosition, balancesLock);
  return <MarketBuyLinks market={market} state={state} compact />;
}
