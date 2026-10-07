"use client";

import Link from "next/link";
import { SettlementCountdown } from "./SettlementCountdown";
import { formatOutcomePrice } from "@/lib/format";
import { impliedLabel, shortQuestion } from "@/lib/copy/payoff";
import { noPriceFromYes } from "@/lib/market/bookTransform";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import { useIntentAvailability } from "@/hooks/useIntentAvailability";
import { useTradingBlockedByBanner } from "@/components/layout/GlobalBanners";
import { useWallet } from "@solana/wallet-adapter-react";

export function MarketCard({ market }: { market: MarketView }) {
  const { nowSec } = useChainClock();
  const { connected } = useWallet();
  const tradingBlocked = useTradingBlockedByBanner();
  const { availability, position } = useIntentAvailability(market.marketId);
  const yes = market.yesMid ?? market.lastYes;
  const no = yes != null ? noPriceFromYes(yes, market.tickSize) : undefined;
  const whenShort = new Date(market.tradingCloseTs * 1000).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "America/Chicago" },
  );
  const cd = getCountdown(market, nowSec);
  const tradeDisabled = !cd.tradingEnabled || tradingBlocked;

  const buyYesOk = availability["buy-yes"].enabled && !tradeDisabled;
  const buyNoOk = availability["buy-no"].enabled && !tradeDisabled;

  const holdBadge =
    connected && position.yesQty >= (market.lotSize ?? 1)
      ? `You: Yes ${position.yesQty}`
      : connected && position.noQty >= (market.lotSize ?? 1)
        ? `You: No ${position.noQty}`
        : null;

  return (
    <article className="card" style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
        <span className="chip">{market.underlyingSymbol}</span>
        <SettlementCountdown market={market} compact />
      </div>
      <Link
        href={`/markets/${market.marketId}`}
        style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none" }}
      >
        {shortQuestion(
          market.underlyingSymbol,
          market.comparator,
          market.strike,
          whenShort,
        )}
      </Link>
      <div className="tabular" style={{ display: "flex", gap: "1rem", fontSize: "0.95rem" }}>
        <span>
          Yes{" "}
          <strong style={{ color: "var(--yes)" }}>
            {yes != null ? formatOutcomePrice(yes) : "—"}
          </strong>
        </span>
        <span>
          No{" "}
          <strong style={{ color: "var(--no)" }}>
            {no != null ? formatOutcomePrice(no) : "—"}
          </strong>
        </span>
      </div>
      {yes != null && (
        <div className="muted" style={{ fontSize: "0.8rem" }}>
          {impliedLabel(yes)}
        </div>
      )}
      {market.underlyingPrice != null && (
        <div className="muted" style={{ fontSize: "0.8rem" }}>
          Underlying ${market.underlyingPrice.toFixed(2)} · dist{" "}
          {(market.underlyingPrice - market.strike).toFixed(2)}
        </div>
      )}
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        24h vol {market.volume24hUsdc?.toLocaleString() ?? "—"} USDC · OI{" "}
        {market.openInterest?.toLocaleString() ?? "—"}
      </div>
      {holdBadge && (
        <span className={`chip ${position.yesQty > 0 ? "chip-yes" : "chip-no"}`}>
          {holdBadge}
        </span>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
        <Link
          className="btn btn-yes"
          href={`/markets/${market.marketId}?intent=buy-yes&side=yes`}
          aria-disabled={!buyYesOk}
          title={
            !availability["buy-yes"].enabled
              ? availability["buy-yes"].copy
              : tradeDisabled
                ? "Trading unavailable"
                : undefined
          }
          style={!buyYesOk ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          Buy Yes
        </Link>
        <Link
          className="btn btn-no"
          href={`/markets/${market.marketId}?intent=buy-no&side=no`}
          aria-disabled={!buyNoOk}
          title={
            !availability["buy-no"].enabled
              ? availability["buy-no"].copy
              : tradeDisabled
                ? "Trading unavailable"
                : undefined
          }
          style={!buyNoOk ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          Buy No
        </Link>
      </div>
    </article>
  );
}
