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
import { SettleProofCard } from "@/components/market/SettleProofCard";
import { displayBook } from "@/lib/market/fixtures";
import { fixturesAllowed } from "@/lib/solana/config";
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
import { useMarketAccount } from "@/hooks/useMarketAccount";
import { useWalletHistory } from "@/hooks/useWalletHistory";
import { getCountdown } from "@/lib/market/countdown";
import { CancelOrdersButton } from "@/components/portfolio/PhoenixActions";
import { useUnderlyingPrice } from "@/hooks/useUnderlyingPrice";
import { useChainClock } from "@/components/providers/AppProviders";
import { DEFAULT_PROGRAM_ID } from "@/lib/solana/config";
import { listDemoOpenOrdersAcrossMarkets } from "@/lib/demo/portfolio";
import { demoHistoryRows } from "@/lib/history/view";
import { demoMarketAllowed } from "@/lib/portfolio/demoMode";
import { onTablistKeyDown, selectableRowProps, tabProps } from "@/components/ui/a11y";
import { useRememberViewedMarket } from "@/components/ui/useLastViewedMarket";
import { toggleSelection } from "@/lib/ui/selection";

const VALID_INTENTS = new Set<Intent>([
  "buy-yes",
  "sell-yes",
  "buy-no",
  "sell-no",
]);

type ZoneTab = "position" | "orders" | "fills";

const INTENT_LABEL: Record<Intent, string> = {
  "buy-yes": "Buy Yes",
  "buy-no": "Buy No",
  "sell-yes": "Sell Yes",
  "sell-no": "Sell No",
};

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
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  useRememberViewedMarket(market.marketId);
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
    () => displayBook(liveBook, market, fixturesAllowed()),
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

  // Wallet Yes/No/USDC + Phoenix seat + resting orders (DLV-088/087). Demo only for localnet fixtures.
  const demoMarket = demoMarketAllowed(market.marketId);
  const account = useMarketAccount(market);
  const underlying = useUnderlyingPrice(market);
  const { availability, position, openOrders, lifecycle } = useIntentAvailability(market.marketId, {
    position: account.position ?? undefined,
    openOrders: account.openOrders ?? undefined,
    balancesLoading: account.connected && account.loading && !account.position,
    lifecycle: getCountdown(market, nowSec).state,
    lotSize: market.lotSize,
  });

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

  const marketOrders = useMemo(
    () =>
      demoMarket
        ? listDemoOpenOrdersAcrossMarkets()
            .filter((o) => o.marketId === market.marketId)
            .map((o) => ({ id: o.id, intent: o.intent, intentPrice: o.price, size: o.size - o.filled, demo: true as const }))
        : account.orders.map((o) => ({ ...o, demo: false as const })),
    [demoMarket, market.marketId, account.orders],
  );
  const history = useWalletHistory(demoMarket ? undefined : [market], account.connected);
  const marketFills = useMemo(
    () =>
      (demoMarket ? demoHistoryRows(nowSec) : history.data?.rows ?? []).filter(
        (h) => h.marketId === market.marketId && h.type === "trade",
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMarket, demoMarket ? nowSec : 0, history.data, market.marketId],
  );
  const seat = account.state?.phoenix?.seat ?? null;

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
            {underlying != null ? `$${underlying.price.toFixed(2)}` : "—"}{" "}
            · {underlying?.source === "mock" ? "mock Pyth" : "Pyth"}
            {underlying?.publishTime != null &&
              ` · ${Math.max(0, nowSec - underlying.publishTime)}s ago`}
            {" · "}24h {market.volume24hUsdc?.toLocaleString() ?? "—"} · OI{" "}
            {market.openInterest?.toLocaleString() ?? "—"}
          </div>
        </div>
        <div className="trade-header-right">
          {/* Yes/No prices double as the book perspective toggle */}
          <div className="trade-persp" role="group" aria-label="Book perspective">
            <button
              type="button"
              className="btn sel-yes"
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
              className="btn sel-no"
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
          {market.status !== "open" && (
            <div className="trade-proof">
              <SettleProofCard market={market} />
            </div>
          )}
          {market.status === "open" && (
            <div className="card trade-chart">
              <strong>Chart (stub)</strong>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
                Chart stub — implied price series + Pyth overlay not wired (TODO(indexer)). Mid{" "}
                {formatOutcomePrice(perspective === "yes" ? yes : no)} ({perspective}).
              </p>
            </div>
          )}
          {market.status === "open" && (
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
          )}
          <section className="card trade-zone">
            <div
              role="tablist"
              aria-label="Market activity"
              onKeyDown={onTablistKeyDown}
              style={{ marginBottom: "0.75rem" }}
            >
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
                  id={`zone-tab-${id}`}
                  aria-controls="zone-panel"
                  {...tabProps(zoneTab === id, () => setZoneTab(id))}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="zone-panel" aria-labelledby={`zone-tab-${zoneTab}`}>
              {zoneTab === "position" && (
                <PositionPanel
                  market={market}
                  yesQty={account.state?.wallet.yes ?? position.yesQty}
                  noQty={account.state?.wallet.no ?? position.noQty}
                  seat={seat}
                  loading={account.connected && account.loading && !account.state}
                />
              )}
              {zoneTab === "orders" && (
                <div>
                  {marketOrders.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      No resting orders on this market.
                    </p>
                  ) : (
                    <table className="markets-table" role="grid" aria-label="Open orders">
                      <thead>
                        <tr>
                          <th>Intent</th>
                          <th>Price</th>
                          <th>Remaining</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {marketOrders.map((o) => (
                          <tr
                            key={o.id}
                            {...selectableRowProps(selectedRow === o.id, () =>
                              setSelectedRow((c) => toggleSelection(c, o.id)),
                            )}
                          >
                            <td>{INTENT_LABEL[o.intent]}</td>
                            <td className="tabular">{o.intentPrice.toFixed(2)}</td>
                            <td className="tabular">{o.size}</td>
                            <td>
                              {!o.demo && market.phoenixMarket ? (
                                <CancelOrdersButton phoenixMarket={market.phoenixMarket} orders={[o]} />
                              ) : (
                                <span className="muted" style={{ fontSize: "0.78rem" }}>demo</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {market.phoenixMarket && account.orders.length > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <CancelOrdersButton
                        phoenixMarket={market.phoenixMarket}
                        orders={account.orders}
                        label={`Cancel all (${account.orders.length})`}
                        compact={false}
                      />
                    </div>
                  )}
                  <p className="muted" style={{ fontSize: "0.78rem", margin: "8px 0 0" }}>
                    Resting buys count toward the one-side rule. Cancelling returns funds to your wallet.
                  </p>
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
                    <table className="markets-table" role="grid" aria-label="Fills">
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
                          <tr
                            key={f.id}
                            {...selectableRowProps(selectedRow === f.id, () =>
                              setSelectedRow((c) => toggleSelection(c, f.id)),
                            )}
                          >
                            <td>
                              {new Date(f.ts * 1000).toLocaleString("en-US", {
                                timeZone: "America/Chicago",
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </td>
                            <td>{f.intent}</td>
                            <td className="tabular">
                              {f.price != null ? f.price.toFixed(2) : "—"}
                            </td>
                            <td className="tabular">{f.size ?? "—"}</td>
                            <td className="tabular">
                              {f.usdcDelta ? `${f.usdcDelta > 0 ? "+" : ""}${f.usdcDelta.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
                    Lifecycle: {lifecycle}.{" "}
                    {demoMarket
                      ? "Localnet fixture fills (demo)."
                      : "Your taker fills from this wallet's transactions; resting-order fills show in Position → Phoenix."}
                  </p>
                </div>
              )}
            </div>
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
            usdcBalance={account.usdc}
            onTicketChange={setTicketState}
            underlying={underlying}
          />
        </aside>
      </div>
    </div>
  );
}
