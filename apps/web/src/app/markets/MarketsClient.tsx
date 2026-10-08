"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { MarketCard } from "@/components/market/MarketCard";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import { expiryChipLabel, expiryKey } from "@/lib/market/fixtures";
import { formatOutcomePrice } from "@/lib/format";
import { noPriceFromYes } from "@/lib/market/bookTransform";
import { impliedText, marketPriceDisplay } from "@/lib/market/priceDisplay";
import { useLastViewedMarket } from "@/components/ui/useLastViewedMarket";
import { useWalletPositions } from "@/hooks/useWalletPositions";
import { MarketBuyCell } from "@/components/market/MarketBuyLinks";

type StatusFilter = "open" | "closing-soon" | "closed" | "settled" | "all";
type ViewMode = "cards" | "table" | "ladder";

export function MarketsClient({
  markets,
  initialStatus,
  initialQuery,
  initialSort,
  initialView,
  initialUnderlyings,
  initialExpiry,
  dataSource = "fixtures",
  fixtureBanner,
}: {
  markets: MarketView[];
  initialStatus: string;
  initialQuery: string;
  initialSort: string;
  initialView?: string;
  initialUnderlyings?: string;
  initialExpiry?: string;
  dataSource?: "indexer-http" | "rpc-gpa" | "fixtures" | "unavailable";
  fixtureBanner?: string;
}) {
  const { nowSec } = useChainClock();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<StatusFilter>(
    (["open", "closing-soon", "closed", "settled", "all"].includes(initialStatus)
      ? initialStatus
      : "open") as StatusFilter,
  );
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [view, setView] = useState<ViewMode>(
    (["cards", "table", "ladder"].includes(initialView ?? "")
      ? initialView
      : "cards") as ViewMode,
  );
  const [underlyings, setUnderlyings] = useState<string[]>(
    initialUnderlyings
      ? initialUnderlyings.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
  );
  const [expiry, setExpiry] = useState<string>(initialExpiry ?? "");
  const lastViewed = useLastViewedMarket();
  // One batched balance read for every listed market (null when disconnected).
  const { positions: livePositions, lock: balancesLock } = useWalletPositions(markets);

  const allUnderlyings = useMemo(() => {
    const set = new Set(markets.map((m) => m.underlyingSymbol));
    return [...set].sort();
  }, [markets]);

  const allExpiries = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of markets) {
      const k = expiryKey(m.tradingCloseTs);
      if (!map.has(k)) map.set(k, m.tradingCloseTs);
    }
    return [...map.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([key, ts]) => ({ key, label: expiryChipLabel(ts), ts }));
  }, [markets]);

  function syncUrl(next: {
    status?: string;
    q?: string;
    sort?: string;
    view?: string;
    u?: string[];
    expiry?: string;
  }) {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const query = next.q ?? q;
    const so = next.sort ?? sort;
    const v = next.view ?? view;
    const u = next.u ?? underlyings;
    const ex = next.expiry ?? expiry;
    if (s && s !== "open") params.set("status", s);
    if (query) params.set("q", query);
    if (so && so !== "close") params.set("sort", so);
    if (v && v !== "cards") params.set("view", v);
    if (u.length) params.set("u", u.join(","));
    if (ex) params.set("expiry", ex);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggleUnderlying(sym: string) {
    const next = underlyings.includes(sym)
      ? underlyings.filter((x) => x !== sym)
      : [...underlyings, sym];
    setUnderlyings(next);
    syncUrl({ u: next });
  }

  const filtered = useMemo(() => {
    let list = [...markets];
    list = list.filter((m) => {
      const cd = getCountdown(m, nowSec);
      switch (status) {
        case "open":
          return cd.state === "open" || cd.state === "closing-soon";
        case "closing-soon":
          return cd.state === "closing-soon";
        case "closed":
          return cd.state === "closed" || cd.state === "resolving" || cd.state === "delayed";
        case "settled":
          return cd.state === "settled" || cd.state === "voided";
        default:
          return true;
      }
    });
    if (underlyings.length) {
      list = list.filter((m) => underlyings.includes(m.underlyingSymbol));
    }
    if (expiry) {
      list = list.filter((m) => expiryKey(m.tradingCloseTs) === expiry);
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.underlyingSymbol.toLowerCase().includes(needle) ||
          m.question.toLowerCase().includes(needle),
      );
    }
    if (sort === "volume") {
      list.sort((a, b) => (b.volume24hUsdc ?? 0) - (a.volume24hUsdc ?? 0));
    } else if (sort === "oi") {
      list.sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0));
    } else if (sort === "newest") {
      list.sort((a, b) => b.tradingCloseTs - a.tradingCloseTs);
    } else if (status === "settled") {
      // Recently settled: newest settlement first (DLV-076).
      list.sort((a, b) => (b.resolvedAt ?? b.settleTs) - (a.resolvedAt ?? a.settleTs));
    } else {
      list.sort((a, b) => a.tradingCloseTs - b.tradingCloseTs);
    }
    return list;
  }, [markets, status, q, sort, nowSec, underlyings, expiry]);

  const settledCount = useMemo(
    () =>
      markets.filter((m) => {
        const st = getCountdown(m, nowSec).state;
        return st === "settled" || st === "voided";
      }).length,
    [markets, nowSec],
  );

  const ladderGroups = useMemo(() => {
    const groups = new Map<string, MarketView[]>();
    for (const m of filtered) {
      const key = `${m.underlyingSymbol}|${expiryKey(m.tradingCloseTs)}`;
      const arr = groups.get(key) ?? [];
      arr.push(m);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => a.strike - b.strike);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.65rem",
          margin: "1rem 0 0.75rem",
          alignItems: "center",
        }}
      >
        <input
          placeholder="Search ticker or question"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            syncUrl({ q: e.target.value });
          }}
          style={{
            flex: "1 1 200px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.5rem 0.75rem",
            color: "var(--text)",
          }}
        />
        <select
          aria-label="Status filter"
          value={status}
          onChange={(e) => {
            const v = e.target.value as StatusFilter;
            setStatus(v);
            syncUrl({ status: v });
          }}
          style={selectStyle}
        >
          <option value="open">Open</option>
          <option value="closing-soon">Closing soon</option>
          <option value="closed">Closed</option>
          <option value="settled">Recently settled</option>
          <option value="all">All</option>
        </select>
        <select
          aria-label="Sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            syncUrl({ sort: e.target.value });
          }}
          style={selectStyle}
        >
          <option value="close">Closing soonest</option>
          <option value="volume">Volume 24h</option>
          <option value="oi">Open interest</option>
          <option value="newest">Newest</option>
        </select>
        <div className="view-toggle" role="group" aria-label="View mode">
          {(
            [
              ["cards", "Cards"],
              ["table", "Table"],
              ["ladder", "Ladder"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                syncUrl({ view: id });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginBottom: "0.75rem",
          alignItems: "center",
        }}
      >
        {settledCount > 0 && (
          <button
            type="button"
            className="filter-chip"
            data-testid="recently-settled-chip"
            aria-pressed={status === "settled"}
            title="Settled markets with their Pyth settlement proof"
            onClick={() => {
              const next: StatusFilter = status === "settled" ? "open" : "settled";
              setStatus(next);
              syncUrl({ status: next });
            }}
            style={{ marginRight: 8 }}
          >
            Recently settled ({settledCount})
          </button>
        )}
        <span className="muted" style={{ fontSize: "0.8rem", marginRight: 4 }}>
          Underlying
        </span>
        {allUnderlyings.map((sym) => (
          <button
            key={sym}
            type="button"
            className="filter-chip"
            aria-pressed={underlyings.includes(sym)}
            onClick={() => toggleUnderlying(sym)}
          >
            {sym}
          </button>
        ))}
        <span className="muted" style={{ fontSize: "0.8rem", margin: "0 4px 0 12px" }}>
          Expiry
        </span>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={expiry === ""}
          onClick={() => {
            setExpiry("");
            syncUrl({ expiry: "" });
          }}
        >
          Any
        </button>
        {allExpiries.map((e) => (
          <button
            key={e.key}
            type="button"
            className="filter-chip"
            aria-pressed={expiry === e.key}
            onClick={() => {
              setExpiry(e.key);
              syncUrl({ expiry: e.key });
            }}
          >
            {e.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            {markets.length === 0
              ? "No markets yet."
              : "No markets match these filters."}
          </p>
          {markets.length > 0 && (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                setStatus("open");
                setQ("");
                setUnderlyings([]);
                setExpiry("");
                syncUrl({ status: "open", q: "", u: [], expiry: "" });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : view === "cards" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {filtered.map((m) => (
            <MarketCard
              key={m.marketId}
              market={m}
              lastViewed={m.marketId === lastViewed}
              livePosition={livePositions?.get(m.marketId)}
              balancesLock={balancesLock}
            />
          ))}
        </div>
      ) : view === "table" ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="markets-table">
            <thead>
              <tr>
                <th>Underlying</th>
                <th>Question</th>
                <th>Yes bid/ask</th>
                <th>No bid/ask</th>
                <th>Implied</th>
                <th>Last</th>
                <th>24h vol</th>
                <th>OI</th>
                <th>Closes</th>
                <th>Status</th>
                <th>Trade</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const cd = getCountdown(m, nowSec);
                const noBid =
                  m.yesAsk != null ? noPriceFromYes(m.yesAsk, m.tickSize) : undefined;
                const noAsk =
                  m.yesBid != null ? noPriceFromYes(m.yesBid, m.tickSize) : undefined;
                return (
                  <tr
                    key={m.marketId}
                    className={m.marketId === lastViewed ? "is-recent" : undefined}
                    aria-current={m.marketId === lastViewed ? "true" : undefined}
                  >
                    <td>
                      {m.underlyingSymbol}
                      {m.marketId === lastViewed && (
                        <span className="chip chip-current" style={{ marginLeft: 6 }}>
                          Last viewed
                        </span>
                      )}
                    </td>
                    <td>
                      <Link href={`/markets/${m.marketId}`}>{m.question}</Link>
                    </td>
                    <td className="tabular">
                      {m.yesBid != null ? formatOutcomePrice(m.yesBid) : "—"} /{" "}
                      {m.yesAsk != null ? formatOutcomePrice(m.yesAsk) : "—"}
                    </td>
                    <td className="tabular">
                      {noBid != null ? formatOutcomePrice(noBid) : "—"} /{" "}
                      {noAsk != null ? formatOutcomePrice(noAsk) : "—"}
                    </td>
                    {/* DLV-116 (docs/ui/08): implied, never a bare mid */}
                    <td className="tabular">{impliedText(marketPriceDisplay(m))}</td>
                    <td className="tabular">
                      {m.lastYes != null ? formatOutcomePrice(m.lastYes) : "—"}
                    </td>
                    <td className="tabular">{m.volume24hUsdc?.toLocaleString() ?? "—"}</td>
                    <td className="tabular">{m.openInterest?.toLocaleString() ?? "—"}</td>
                    <td>{cd.relativeLabel}</td>
                    <td>{cd.state}</td>
                    <td>
                      <MarketBuyCell market={m} livePosition={livePositions?.get(m.marketId)} balancesLock={balancesLock} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {ladderGroups.map(([key, rows]) => {
            const [sym] = key.split("|");
            const under = rows[0]?.underlyingPrice;
            let nearestId = rows[0]?.marketId;
            if (under != null && rows.length) {
              nearestId = rows.reduce((best, m) =>
                Math.abs(m.strike - under) < Math.abs(best.strike - under) ? m : best,
              ).marketId;
            }
            return (
              <div key={key} className="card" style={{ padding: 0, overflowX: "auto" }}>
                <div
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                  }}
                >
                  {sym} · {expiryChipLabel(rows[0].tradingCloseTs)}
                  {under != null && (
                    <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                      underlying ${under.toFixed(2)}
                    </span>
                  )}
                </div>
                <table className="markets-table">
                  <thead>
                    <tr>
                      <th>Strike</th>
                      <th>Yes bid</th>
                      <th>Yes ask</th>
                      <th>No bid</th>
                      <th>No ask</th>
                      <th>Implied</th>
                      <th>Vol</th>
                      <th>Trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const noBid =
                        m.yesAsk != null
                          ? noPriceFromYes(m.yesAsk, m.tickSize)
                          : undefined;
                      const noAsk =
                        m.yesBid != null
                          ? noPriceFromYes(m.yesBid, m.tickSize)
                          : undefined;
                      return (
                        <tr
                          key={m.marketId}
                          className={
                            [
                              m.marketId === nearestId ? "ladder-near" : "",
                              m.marketId === lastViewed ? "is-recent" : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          aria-current={m.marketId === lastViewed ? "true" : undefined}
                          title={m.marketId === nearestId ? "Nearest strike to underlying" : undefined}
                        >
                          <td>
                            <Link href={`/markets/${m.marketId}`}>
                              ${m.strike.toFixed(2)}
                            </Link>
                          </td>
                          <td className="tabular">
                            {m.yesBid != null ? formatOutcomePrice(m.yesBid) : "—"}
                          </td>
                          <td className="tabular">
                            {m.yesAsk != null ? formatOutcomePrice(m.yesAsk) : "—"}
                          </td>
                          <td className="tabular">
                            {noBid != null ? formatOutcomePrice(noBid) : "—"}
                          </td>
                          <td className="tabular">
                            {noAsk != null ? formatOutcomePrice(noAsk) : "—"}
                          </td>
                          <td className="tabular">
                            {impliedText(marketPriceDisplay(m))}
                          </td>
                          <td className="tabular">
                            {m.volume24hUsdc?.toLocaleString() ?? "—"}
                          </td>
                          <td>
                            <MarketBuyCell
                              market={m}
                              livePosition={livePositions?.get(m.marketId)}
                              balancesLock={balancesLock}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ marginTop: "1.5rem", fontSize: "0.8rem" }}>
        {fixtureBanner
          ? fixtureBanner
          : `Market source: ${dataSource}.`}
      </p>
    </div>
  );
}

const selectStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.5rem 0.65rem",
  color: "var(--text)",
};
