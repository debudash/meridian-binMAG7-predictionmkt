"use client";

import Link from "next/link";
import { SettlementCountdown } from "./SettlementCountdown";
import { formatOutcomePrice } from "@/lib/format";
import { impliedLabel, shortQuestion } from "@/lib/copy/payoff";
import { noPriceFromYes } from "@/lib/market/bookTransform";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";

export function MarketCard({ market }: { market: MarketView }) {
  const { nowSec } = useChainClock();
  const yes = market.yesMid ?? market.lastYes;
  const no = yes != null ? noPriceFromYes(yes, market.tickSize) : undefined;
  const whenShort = new Date(market.tradingCloseTs * 1000).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "America/Chicago" },
  );
  const cd = getCountdown(market, nowSec);
  const tradeDisabled = !cd.tradingEnabled;

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
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
        <Link
          className="btn btn-yes"
          href={`/markets/${market.marketId}?intent=buy-yes`}
          aria-disabled={tradeDisabled}
          style={tradeDisabled ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          Buy Yes
        </Link>
        <Link
          className="btn btn-no"
          href={`/markets/${market.marketId}?intent=buy-no`}
          aria-disabled={tradeDisabled}
          style={tradeDisabled ? { pointerEvents: "none", opacity: 0.45 } : undefined}
        >
          Buy No
        </Link>
      </div>
    </article>
  );
}
