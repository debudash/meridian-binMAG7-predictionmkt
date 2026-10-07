"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
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
import {
  bookKeys,
  bookSelectionReducer,
  initialBookSelection,
  resolveHighlightKey,
  rowKey,
  ticketKey,
  ticketPriceForRow,
  type TicketPriceState,
} from "@/lib/market/bookSelection";
import { yesDefinition, noDefinition, oneLineExplainer } from "@/lib/copy/payoff";
import { useIntentAvailability } from "@/hooks/useIntentAvailability";
import { useLivePosition } from "@/hooks/useLivePosition";
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
    const load = async () => {
      if (!isPhoenixPlacementEnabled(market.phoenixMarket)) {
        if (!cancelled) setLiveBook(null);
        return;
      }
      const snap = await fetchPhoenixBook(market.phoenixMarket, connection);
      if (!cancelled && snap) setLiveBook(snap);
    };
    void load();
    // Poll so fills show up on the ladder without a reload.
    const t = isPhoenixPlacementEnabled(market.phoenixMarket)
      ? setInterval(load, 4000)
      : undefined;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [market.phoenixMarket, connection]);
  const book = useMemo(
    () => liveBook ?? fixtureBook(market),
    [liveBook, market],
  );
  // Book row selection ⇄ ticket price (DLV-071). Keys are Yes-price ticks, so the
  // highlight survives the 4s refresh and both Yes/No perspectives.
  const [ticketState, setTicketState] = useState<TicketPriceState | null>(null);
  const [selection, dispatchSelection] = useReducer(bookSelectionReducer, initialBookSelection);
  const levelKeys = useMemo(() => bookKeys(book, market.tickSize), [book, market.tickSize]);
  const tKey = ticketKey(ticketState, market.tickSize);
  useEffect(() => {
    dispatchSelection({ type: "book", keys: levelKeys });
  }, [levelKeys]);
  useEffect(() => {
    dispatchSelection({ type: "ticket", key: tKey });
  }, [tKey]);
  const highlightKey = resolveHighlightKey(selection, tKey, levelKeys);

  const liveMid =
    liveBook && liveBook.bids[0] && liveBook.asks[0]
      ? (liveBook.bids[0].price + liveBook.asks[0].price) / 2
      : undefined;
  const yes = liveMid ?? market.yesMid ?? market.lastYes ?? 0.5;
  const no = noPriceFromYes(yes, market.tickSize);

  const livePosition = useLivePosition(market);
  const { availability, position, openOrders, lifecycle } = useIntentAvailability(
    market.marketId,
    livePosition
      ? { position: livePosition, openOrders: { openBuyYesQty: 0, openBuyNoQty: 0 } }
      : {},
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
      const key = rowKey(price, perspective, market.tickSize);
      if (key == null) return;
      dispatchSelection({ type: "click", key, highlightedKey: highlightKey });
      if (key === highlightKey) return; // same row again → deselect only
      // Click ask → Buy of current perspective; bid → Sell. If blocked, keep intent, fill price only.
      const buyIntent: Intent = perspective === "yes" ? "buy-yes" : "buy-no";
      const sellIntent: Intent = perspective === "yes" ? "sell-yes" : "sell-no";
      const preferred = side === "ask" ? buyIntent : sellIntent;
      const hint = availability[preferred].enabled ? preferred : null;
      // Ticket quotes in its intent's terms (No intents in No price = 1 − Yes).
      const targetIntent: Intent = hint ?? ticketState?.intent ?? buyIntent;
      setFillPrice(ticketPriceForRow(price, perspective, targetIntent, market.tickSize));
      setFillIntentHint(hint);
    },
    [perspective, availability, market.tickSize, highlightKey, ticketState?.intent],
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

      <header className="card trade-header">
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h1 style={{ margin: 0, fontSize: "1.15rem", lineHeight: 1.3 }}>{market.question}</h1>
          <div className="muted tabular" style={{ fontSize: "0.8rem", marginTop: 4 }}>
            {market.underlyingSymbol}{" "}
            {market.underlyingPrice != null
              ? `$${market.underlyingPrice.toFixed(2)}`
              : "—"}{" "}
            · Pyth
            {market.underlyingPublishTs != null &&
              ` · ${Math.max(0, nowSec - market.underlyingPublishTs)}s ago`}
            {" · "}24h {market.volume24hUsdc?.toLocaleString() ?? "—"} · OI{" "}
            {market.openInterest?.toLocaleString() ?? "—"}
          </div>
        </div>
        <div className="trade-header-right">
          {/* Yes/No prices double as the book perspective toggle */}
          <div className="trade-persp" role="group" aria-label="Book perspective">
            <button
              type="button"
              className="btn"
              aria-pressed={perspective === "yes"}
              onClick={() => syncPerspective("yes")}
            >
              Yes{" "}
              <strong className="tabular" style={{ color: "var(--yes)" }}>
                {formatOutcomePrice(yes)}
              </strong>
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={perspective === "no"}
              onClick={() => syncPerspective("no")}
            >
              No{" "}
              <strong className="tabular" style={{ color: "var(--no)" }}>
                {formatOutcomePrice(no)}
              </strong>
            </button>
          </div>
          <SettlementCountdown market={market} />
        </div>
      </header>

      {intentNote && (
        <div className="banner" style={{ marginBottom: "1rem", borderRadius: 8 }}>
          {intentNote}
        </div>
      )}

      {/* Desktop: flexible main column + fixed sticky ticket column.
          <1024px: one column — header, ticket, book, chart, position, rules (CSS order). */}
      <div className="trade-layout">
        <div className="trade-main">
          <div className="card trade-chart">
            <strong>Chart (stub)</strong>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
              Chart stub — implied price series + Pyth overlay not wired (TODO(indexer)). Mid{" "}
              {formatOutcomePrice(perspective === "yes" ? yes : no)} ({perspective}).
            </p>
          </div>
          <div className="trade-book">
            <OrderBook
              book={book}
              live={liveBook != null}
              perspective={perspective}
              tickSize={market.tickSize}
              onSelectPrice={onSelectPrice}
              selectedKey={highlightKey}
            />
          </div>
          <section className="card trade-zone">
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
          <section className="card trade-rules">
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
        </div>
        <aside className="trade-side">
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
            liveBook={liveBook}
            usdcBalance={livePosition?.usdc}
            onTicketChange={setTicketState}
          />
        </aside>
      </div>

      <style>{`
        .trade-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem 1.25rem;
          padding: 0.75rem 1rem;
          margin-bottom: 16px;
        }
        .trade-header-right { display: flex; align-items: center; gap: 0.75rem 1.25rem; flex-wrap: wrap; }
        .trade-persp { display: flex; gap: 6px; }
        .trade-persp .btn { padding: 0.3rem 0.65rem; font-size: 0.85rem; }
        .trade-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 16px;
          align-items: start;
        }
        .trade-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .trade-main > *, .trade-side { min-width: 0; box-sizing: border-box; }
        .trade-rules p { overflow-wrap: anywhere; }
        .trade-chart { height: 240px; overflow: hidden; }
        .trade-side {
          position: sticky;
          top: 72px;
          align-self: start;
          max-height: calc(100vh - 88px);
          overflow-y: auto;
        }
        @media (max-width: 1023px) {
          .trade-layout { display: flex; flex-direction: column; gap: 16px; }
          .trade-main { display: contents; }
          .trade-main > *, .trade-side { width: 100%; }
          .trade-header { padding: 0.65rem 0.8rem; }
          .trade-side { position: static; max-height: none; overflow: visible; order: 1; }
          .trade-book { order: 2; }
          .trade-chart { order: 3; height: auto; min-height: 120px; }
          .trade-zone { order: 4; }
          .trade-rules { order: 5; }
        }
      `}</style>
    </div>
  );
}
