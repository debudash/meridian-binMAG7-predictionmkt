"use client";

import Link from "next/link";
import { SettlementCountdown } from "./SettlementCountdown";
import { shortQuestion } from "@/lib/copy/payoff";
import { impliedText, marketPriceDisplay } from "@/lib/market/priceDisplay";
import type { MarketView } from "@/lib/market/types";
import { useWallet } from "@solana/wallet-adapter-react";
import type { LiveExposure } from "@/hooks/useWalletPositions";
import type { BalancesLock } from "@/lib/intents/cardLock";
import { MarketBuyLinks, useMarketTradeState } from "./MarketBuyLinks";
import { DistanceReadout } from "@/components/trade/DistanceReadout";
import { positionBadge } from "@/lib/market/positionBadge";

export function MarketCard({
  market,
  lastViewed = false,
  livePosition,
  balancesLock = null,
}: {
  market: MarketView;
  /** M5: list's batched read pending / failed → Buy links locked like the ticket */
  balancesLock?: BalancesLock;
  /** Connected wallet's live Yes/No balance (batched by the list, DLV-074). */
  livePosition?: LiveExposure | null;
  /** Market the user last opened (sessionStorage) — marked "Last viewed" (D-022). */
  lastViewed?: boolean;
}) {
  const { connected } = useWallet();
  const trade = useMarketTradeState(market, livePosition, balancesLock);
  const { position } = trade;
  // DLV-116 (docs/ui/08): no bare mid on the card — `NN% implied` only; prices live on the Buy buttons.
  const display = marketPriceDisplay(market, { open: trade.tradingOpen });
  const settled = market.status === "settled-yes" || market.status === "settled-no" || market.status === "void";
  const whenShort = new Date(market.tradingCloseTs * 1000).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "America/Chicago" },
  );
  const holdBadge = positionBadge({
    connected,
    yesQty: position.yesQty,
    noQty: position.noQty,
    lotSize: market.lotSize,
  });

  return (
    <article
      className={`card market-card${lastViewed ? " is-selected" : ""}`}
      aria-current={lastViewed ? "true" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="chip">{market.underlyingSymbol}</span>
          {lastViewed && <span className="chip chip-current">Last viewed</span>}
        </span>
        <SettlementCountdown market={market} compact />
      </div>
      <Link
        href={`/markets/${market.marketId}`}
        className="market-card-title"
        style={{ fontWeight: 600, textDecoration: "none" }}
      >
        {shortQuestion(
          market.underlyingSymbol,
          market.comparator,
          market.strike,
          whenShort,
        )}
      </Link>
      {!settled && (
        <div className="tabular" style={{ fontSize: "0.95rem" }} data-testid="card-implied">
          {impliedText(display)}
        </div>
      )}
      {market.status === "open" && (
        <DistanceReadout
          compact
          market={market}
          underlying={
            market.underlyingPrice != null
              ? { price: market.underlyingPrice, source: "indexer" }
              : null
          }
        />
      )}
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        24h vol {market.volume24hUsdc?.toLocaleString() ?? "—"} USDC · OI{" "}
        {market.openInterest?.toLocaleString() ?? "—"}
      </div>
      {holdBadge && (
        <span
          className={`chip chip-${holdBadge.tone === "both" ? "amber" : holdBadge.tone}`}
          style={{ alignSelf: "flex-start" }}
          data-testid="position-badge"
        >
          {holdBadge.text}
        </span>
      )}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto" }}>
        {market.status === "settled-yes" || market.status === "settled-no" ? (
          <Link
            href={`/markets/${market.marketId}`}
            className="btn"
            data-testid="view-settle-proof"
          >
            View settlement proof →
          </Link>
        ) : (
          <MarketBuyLinks market={market} state={trade} />
        )}
      </div>
    </article>
  );
}
