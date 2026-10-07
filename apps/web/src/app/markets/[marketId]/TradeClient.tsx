"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Intent } from "@/lib/intents/types";
import type { MarketView } from "@/lib/market/types";
import { SettlementCountdown } from "@/components/market/SettlementCountdown";
import { OrderBook } from "@/components/trade/OrderBook";
import { TradeTicket } from "@/components/trade/TradeTicket";
import { PositionPanel } from "@/components/trade/PositionPanel";
import { fixtureBook } from "@/lib/market/fixtures";
import { formatOutcomePrice } from "@/lib/format";
import { noPriceFromYes, type Perspective } from "@/lib/market/bookTransform";
import { yesDefinition, noDefinition, oneLineExplainer } from "@/lib/copy/payoff";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import { DEFAULT_PROGRAM_ID } from "@/lib/solana/config";

const VALID_INTENTS = new Set<Intent>([
  "buy-yes",
  "sell-yes",
  "buy-no",
  "sell-no",
]);

export function TradeClient({
  market,
  initialIntent,
  initialSide,
  initialPrice,
  initialSize,
}: {
  market: MarketView;
  initialIntent?: string;
  initialSide?: string;
  initialPrice?: number;
  initialSize?: number;
}) {
  const { nowSec } = useChainClock();
  const [perspective, setPerspective] = useState<Perspective>(
    initialSide === "no" ? "no" : "yes",
  );
  const book = useMemo(() => fixtureBook(market), [market]);
  const yes = market.yesMid ?? market.lastYes ?? 0.5;
  const no = noPriceFromYes(yes, market.tickSize);
  const cd = getCountdown(market, nowSec);

  // Deep-link intent validation (06 §2.5)
  const position = { yesQty: 0, noQty: 0 };
  const availability = getIntentAvailability(
    position,
    { openBuyYesQty: 0, openBuyNoQty: 0 },
    { pendingTradeCount: 0 },
    { lifecycle: cd.state, lotSize: market.lotSize },
  );

  let resolvedIntent: Intent | undefined;
  let intentNote: string | undefined;
  if (initialIntent && VALID_INTENTS.has(initialIntent as Intent)) {
    const i = initialIntent as Intent;
    if (availability[i].enabled) {
      resolvedIntent = i;
    } else {
      intentNote = availability[i].copy ?? "Requested intent unavailable.";
      resolvedIntent = (["buy-yes", "buy-no", "sell-yes", "sell-no"] as Intent[]).find(
        (x) => availability[x].enabled,
      );
    }
  }

  const whenLabel = new Date(market.settleTs * 1000).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <div>
      <div style={{ marginBottom: "0.5rem" }}>
        <Link href="/markets" className="muted" style={{ fontSize: "0.85rem" }}>
          ← Markets
        </Link>
      </div>

      <header
        className="card"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.35rem" }}>{market.question}</h1>
          <div className="muted" style={{ fontSize: "0.9rem" }}>
            {market.underlyingSymbol}{" "}
            {market.underlyingPrice != null
              ? `$${market.underlyingPrice.toFixed(2)}`
              : "—"}{" "}
            · Pyth
            {market.underlyingPublishTs != null &&
              ` · ${Math.max(0, nowSec - market.underlyingPublishTs)}s ago`}
          </div>
          <div className="tabular" style={{ marginTop: 8, display: "flex", gap: "1rem" }}>
            <span>
              Yes{" "}
              <strong style={{ color: "var(--yes)" }}>{formatOutcomePrice(yes)}</strong>
            </span>
            <span>
              No{" "}
              <strong style={{ color: "var(--no)" }}>{formatOutcomePrice(no)}</strong>
            </span>
            <span className="muted">
              24h {market.volume24hUsdc?.toLocaleString() ?? "—"} · OI{" "}
              {market.openInterest?.toLocaleString() ?? "—"}
            </span>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn"
              aria-pressed={perspective === "yes"}
              onClick={() => setPerspective("yes")}
            >
              Yes
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={perspective === "no"}
              onClick={() => setPerspective("no")}
            >
              No
            </button>
          </div>
        </div>
        <SettlementCountdown market={market} />
      </header>

      {intentNote && (
        <div className="banner" style={{ marginBottom: "1rem", borderRadius: 8 }}>
          {intentNote}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr) minmax(280px, 3fr)",
          gap: "1rem",
          alignItems: "start",
        }}
        className="trade-grid"
      >
        <div className="card" style={{ minHeight: 280 }}>
          <strong>Chart</strong>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            TODO(indexer): implied price series + Pyth overlay. Mid{" "}
            {formatOutcomePrice(perspective === "yes" ? yes : no)} ({perspective}).
          </p>
        </div>
        <OrderBook book={book} perspective={perspective} tickSize={market.tickSize} />
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <TradeTicket
            market={market}
            perspective={perspective}
            initialIntent={resolvedIntent}
            initialPrice={initialPrice}
            initialSize={initialSize}
            position={position}
          />
          <PositionPanel market={market} />
        </div>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Rules & resolution</h2>
        <p style={{ fontSize: "0.9rem" }}>{oneLineExplainer()}</p>
        <p style={{ fontSize: "0.9rem" }}>
          {yesDefinition(market.underlyingSymbol, market.strike, whenLabel)}
        </p>
        <p style={{ fontSize: "0.9rem" }}>
          {noDefinition(market.underlyingSymbol, market.strike, whenLabel)}
        </p>
        <p className="muted" style={{ fontSize: "0.8rem", fontFamily: "var(--mono)" }}>
          marketId {market.marketId} · program {DEFAULT_PROGRAM_ID}
          {market.phoenixMarket ? ` · phoenix ${market.phoenixMarket}` : " · phoenix unset"}
        </p>
      </section>

      <style>{`
        @media (max-width: 1100px) {
          .trade-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 700px) {
          .trade-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
