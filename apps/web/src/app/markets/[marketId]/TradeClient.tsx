"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Intent } from "@/lib/intents/types";
import type { MarketView } from "@/lib/market/types";
import { SettlementCountdown } from "@/components/market/SettlementCountdown";
import { OrderBook } from "@/components/trade/OrderBook";
import { TradeTicket } from "@/components/trade/TradeTicket";
import { PositionPanel } from "@/components/trade/PositionPanel";
import { fixtureBook } from "@/lib/market/fixtures";
import { fetchPhoenixBook, isPhoenixPlacementEnabled } from "@/lib/phoenix";
import { useConnection } from "@solana/wallet-adapter-react";
import type { OrderBookSnapshot } from "@/lib/market/types";
import { formatOutcomePrice } from "@/lib/format";
import { noPriceFromYes, type Perspective } from "@/lib/market/bookTransform";
import { yesDefinition, noDefinition, oneLineExplainer } from "@/lib/copy/payoff";
import { useIntentAvailability } from "@/hooks/useIntentAvailability";
import { useChainClock } from "@/components/providers/AppProviders";
import { DEFAULT_PROGRAM_ID } from "@/lib/solana/config";
import { listDemoOpenOrdersAcrossMarkets, buildDemoHistory } from "@/lib/demo/portfolio";

const VALID_INTENTS = new Set<Intent>([
  "buy-yes",
  "sell-yes",
  "buy-no",
  "sell-no",
]);

type ZoneTab = "position" | "orders" | "fills";

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
  const { connection } = useConnection();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [perspective, setPerspective] = useState<Perspective>(
    initialSide === "no" ? "no" : "yes",
  );
  const [zoneTab, setZoneTab] = useState<ZoneTab>("position");
  const [fillPrice, setFillPrice] = useState<number | null>(null);
  const [fillIntentHint, setFillIntentHint] = useState<Intent | null>(null);

  const [liveBook, setLiveBook] = useState<OrderBookSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPhoenixPlacementEnabled(market.phoenixMarket)) {
        if (!cancelled) setLiveBook(null);
        return;
      }
      const snap = await fetchPhoenixBook(market.phoenixMarket, connection);
      if (!cancelled) setLiveBook(snap);
    })();
    return () => {
      cancelled = true;
    };
  }, [market.phoenixMarket, connection]);
  const book = useMemo(
    () => liveBook ?? fixtureBook(market),
    [liveBook, market],
  );
  const yes = market.yesMid ?? market.lastYes ?? 0.5;
  const no = noPriceFromYes(yes, market.tickSize);

  const { availability, position, openOrders, lifecycle } = useIntentAvailability(
    market.marketId,
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

  const syncPerspective = useCallback(
    (next: Perspective) => {
      setPerspective(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("side", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onSelectPrice = useCallback(
    (price: number, side: "bid" | "ask") => {
      // Click ask → Buy of current perspective; bid → Sell. If blocked, keep intent, fill price only.
      const buyIntent: Intent = perspective === "yes" ? "buy-yes" : "buy-no";
      const sellIntent: Intent = perspective === "yes" ? "sell-yes" : "sell-no";
      const preferred = side === "ask" ? buyIntent : sellIntent;
      setFillPrice(price);
      setFillIntentHint(availability[preferred].enabled ? preferred : null);
    },
    [perspective, availability],
  );

  const clearFill = useCallback(() => {
    setFillPrice(null);
    setFillIntentHint(null);
  }, []);

  const whenLabel = new Date(market.settleTs * 1000).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const marketOrders = listDemoOpenOrdersAcrossMarkets().filter(
    (o) => o.marketId === market.marketId,
  );
  const marketFills = buildDemoHistory(nowSec).filter(
    (h) => h.marketId === market.marketId && h.type === "fill",
  );

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
              onClick={() => syncPerspective("yes")}
            >
              Yes
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={perspective === "no"}
              onClick={() => syncPerspective("no")}
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
          <strong>Chart (stub)</strong>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Chart stub — implied price series + Pyth overlay not wired (TODO(indexer)). Mid{" "}
            {formatOutcomePrice(perspective === "yes" ? yes : no)} ({perspective}).
          </p>
        </div>
        <OrderBook
          book={book}
          perspective={perspective}
          tickSize={market.tickSize}
          onSelectPrice={onSelectPrice}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <TradeTicket
            market={market}
            perspective={perspective}
            initialIntent={resolvedIntent}
            initialPrice={initialPrice}
            initialSize={initialSize}
            position={position}
            availability={availability}
            openOrders={openOrders}
            fillPrice={fillPrice}
            fillIntentHint={fillIntentHint}
            onConsumedFill={clearFill}
          />
          <PositionPanel
            market={market}
            yesQty={position.yesQty}
            noQty={position.noQty}
          />
        </div>
      </div>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {(
            [
              ["position", "Position"],
              ["orders", `Open orders${marketOrders.length ? ` (${marketOrders.length})` : ""}`],
              ["fills", `Fills${marketFills.length ? ` (${marketFills.length})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn"
              aria-pressed={zoneTab === id}
              onClick={() => setZoneTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {zoneTab === "position" && (
          <PositionPanel
            market={market}
            yesQty={position.yesQty}
            noQty={position.noQty}
          />
        )}
        {zoneTab === "orders" && (
          <div>
            {marketOrders.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No open orders for this market. TODO(phoenix): Phoenix trader state.
              </p>
            ) : (
              <table className="markets-table">
                <thead>
                  <tr>
                    <th>Intent</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Filled</th>
                  </tr>
                </thead>
                <tbody>
                  {marketOrders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.intent}</td>
                      <td className="tabular">{o.price.toFixed(2)}</td>
                      <td className="tabular">{o.size}</td>
                      <td className="tabular">{o.filled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {zoneTab === "fills" && (
          <div>
            {marketFills.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No fills yet.{" "}
                <Link href="/history">History</Link>
              </p>
            ) : (
              <table className="markets-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Intent</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {marketFills.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {new Date(f.ts * 1000).toLocaleString("en-US", {
                          timeZone: "America/Chicago",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>{f.intentOrOutcome}</td>
                      <td className="tabular">
                        {f.price != null ? f.price.toFixed(2) : "—"}
                      </td>
                      <td className="tabular">{f.size}</td>
                      <td className="tabular">
                        {f.amountUsdc != null ? f.amountUsdc.toFixed(2) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
              Lifecycle: {lifecycle}. Fixture fills when no indexer.
            </p>
          </div>
        )}
      </section>

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
