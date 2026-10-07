import type { CSSProperties } from "react";
"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MarketCard } from "@/components/market/MarketCard";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";

type StatusFilter = "open" | "closing-soon" | "closed" | "settled" | "all";

export function MarketsClient({
  markets,
  initialStatus,
  initialQuery,
  initialSort,
}: {
  markets: MarketView[];
  initialStatus: string;
  initialQuery: string;
  initialSort: string;
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

  function syncUrl(next: { status?: string; q?: string; sort?: string }) {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const query = next.q ?? q;
    const so = next.sort ?? sort;
    if (s && s !== "open") params.set("status", s);
    if (query) params.set("q", query);
    if (so && so !== "close") params.set("sort", so);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
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
    } else if (sort === "newest") {
      list.sort((a, b) => b.tradingCloseTs - a.tradingCloseTs);
    } else {
      list.sort((a, b) => a.tradingCloseTs - b.tradingCloseTs);
    }
    return list;
  }, [markets, status, q, sort, nowSec]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.65rem",
          margin: "1rem 0 1.25rem",
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
          <option value="settled">Settled</option>
          <option value="all">All</option>
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            syncUrl({ sort: e.target.value });
          }}
          style={selectStyle}
        >
          <option value="close">Closing soonest</option>
          <option value="volume">Volume 24h</option>
          <option value="newest">Newest</option>
        </select>
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
                syncUrl({ status: "open", q: "" });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {filtered.map((m) => (
            <MarketCard key={m.marketId} market={m} />
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: "1.5rem", fontSize: "0.8rem" }}>
        Showing fixture markets (no indexer configured). TODO(schema): registry via indexer or
        getProgramAccounts.
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
