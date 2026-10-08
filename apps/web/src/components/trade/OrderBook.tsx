"use client";

import { transformBook, type Perspective } from "@/lib/market/bookTransform";
import type { OrderBookSnapshot } from "@/lib/market/types";
import { formatOutcomePrice } from "@/lib/format";
import { PHOENIX_STUB_NOTICE } from "@/lib/phoenix/stub";
import { liveBookFooter } from "@/lib/rpc/pollPolicy";
import { rowKey } from "@/lib/market/bookSelection";
import type { KeyboardEvent } from "react";

/** Arrow keys move focus between price levels (rows stay native buttons for Enter/Space). */
function onLadderKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]"));
  const i = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

export function OrderBook({
  book,
  perspective,
  tickSize,
  onSelectPrice,
  selectedKey = null,
  live = false,
}: {
  /** true when `book` is the on-chain Phoenix ladder (not the fixture stub) */
  live?: boolean;
  book: OrderBookSnapshot;
  perspective: Perspective;
  tickSize: number;
  onSelectPrice?: (price: number, side: "bid" | "ask") => void;
  /** Highlighted level as a Yes-price tick key (see lib/market/bookSelection). */
  selectedKey?: number | null;
}) {
  const isSelected = (price: number) =>
    selectedKey != null && rowKey(price, perspective, tickSize) === selectedKey;
  const view = transformBook(book, perspective, tickSize);
  const bestBid = view.bids[0]?.price;
  const bestAsk = view.asks[0]?.price;
  const mid =
    bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : undefined;
  const spread =
    bestBid != null && bestAsk != null ? bestAsk - bestBid : undefined;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "0.65rem 0.85rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.85rem",
        }}
      >
        <strong>Order book · {perspective === "yes" ? "Yes" : "No"}</strong>
        <span className="muted tabular">
          {spread != null && mid != null
            ? `Spread ${formatOutcomePrice(spread)} · Mid ${formatOutcomePrice(mid)}`
            : "No orders yet"}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0,
          fontSize: "0.8rem",
          padding: "0.35rem 0.85rem",
          color: "var(--text-muted)",
        }}
      >
        <span>Price</span>
        <span style={{ textAlign: "right" }}>Size</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>
      <div
        role="listbox"
        aria-label={`Order book ${perspective === "yes" ? "Yes" : "No"} price levels`}
        onKeyDown={onLadderKeyDown}
        style={{ maxHeight: 220, overflow: "auto" }}
      >
        {[...view.asks].reverse().slice(0, 8).map((l) => (
          <BookRow
            key={`a-${l.price}`}
            level={l}
            kind="ask"
            selected={isSelected(l.price)}
            onClick={() => onSelectPrice?.(l.price, "ask")}
          />
        ))}
        {[...view.bids].slice(0, 8).map((l) => (
          <BookRow
            key={`b-${l.price}`}
            level={l}
            kind="bid"
            selected={isSelected(l.price)}
            onClick={() => onSelectPrice?.(l.price, "bid")}
          />
        ))}
      </div>
      <div
        className="muted"
        style={{ padding: "0.5rem 0.85rem", fontSize: "0.72rem", borderTop: "1px solid var(--border)" }}
      >
        {live ? liveBookFooter() : PHOENIX_STUB_NOTICE}
      </div>
    </div>
  );
}

function BookRow({
  level,
  kind,
  selected = false,
  onClick,
}: {
  level: { price: number; size: number };
  kind: "bid" | "ask";
  selected?: boolean;
  onClick?: () => void;
}) {
  // Bid/ask book colors — NOT Yes/No side accents (nit #5)
  const color = kind === "ask" ? "var(--ask)" : "var(--bid)";
  const total = level.price * level.size;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${kind === "ask" ? "Ask" : "Bid"} ${formatOutcomePrice(level.price)}, size ${level.size}`}
      className={`book-row${selected ? " book-row-selected" : ""}`}
      data-side={kind}
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        width: "100%",
        border: "none",
        // Selected: tint + left accent bar in the row's own bid/ask color.
        background: selected
          ? `color-mix(in srgb, ${color} 18%, transparent)`
          : "transparent",
        boxShadow: selected ? `inset 3px 0 0 ${color}` : undefined,
        fontWeight: selected ? 600 : undefined,
        color: "var(--text)",
        padding: "0.28rem 0.85rem",
        cursor: "pointer",
        fontFamily: "var(--mono)",
        fontSize: "0.8rem",
      }}
    >
      <span style={{ color }}>{formatOutcomePrice(level.price)}</span>
      <span style={{ textAlign: "right" }}>{level.size}</span>
      <span style={{ textAlign: "right", color: "var(--text-muted)" }}>
        {total.toFixed(2)}
      </span>
    </button>
  );
}
