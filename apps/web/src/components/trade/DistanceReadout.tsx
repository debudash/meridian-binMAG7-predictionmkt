"use client";

import { distanceToStrike } from "@/lib/copy/whatIf";
import type { MarketView } from "@/lib/market/types";
import type { UnderlyingQuote } from "@/hooks/useUnderlyingPrice";

function sourceLabel(q: UnderlyingQuote): string {
  if (q.source === "mock") return "mock Pyth";
  return "Pyth";
}

/**
 * Compact live distance to strike (DLV-075): "NVDA $138.20 · needs +1.3%".
 * Leading side tinted (≥ strike → Yes, D-005). No price → "—".
 */
export function DistanceReadout({
  market,
  underlying,
  compact = false,
}: {
  market: Pick<MarketView, "underlyingSymbol" | "strike">;
  underlying?: UnderlyingQuote | null;
  compact?: boolean;
}) {
  const d = distanceToStrike(market.underlyingSymbol, underlying?.price, market.strike);
  return (
    <p
      className="muted tabular"
      data-testid="distance-to-strike"
      title={
        underlying
          ? `${sourceLabel(underlying)}${underlying.publishSlot ? ` · slot ${underlying.publishSlot}` : ""} · strike $${market.strike.toFixed(2)} (Yes if ≥)`
          : "No underlying price feed available"
      }
      style={{
        margin: compact ? 0 : "0.45rem 0 0",
        paddingTop: compact ? 0 : "0.45rem",
        borderTop: compact ? "none" : "1px dashed var(--border)",
        fontSize: compact ? "0.8rem" : "0.78rem",
      }}
    >
      {d ? (
        <>
          <span style={{ color: "var(--text)" }}>{d.priceLabel}</span>
          {" · "}
          <span style={{ color: d.leading === "yes" ? "var(--yes)" : "var(--no)", fontWeight: 600 }}>
            {/* D-028: arrow repeats the colour cue (above strike ▲ = Yes leading, below ▼ = No leading) */}
            <span aria-hidden="true">{d.leading === "yes" ? "▲ " : "▼ "}</span>
            {d.distanceLabel}
          </span>
          {!compact && underlying && <span> · {sourceLabel(underlying)}</span>}
        </>
      ) : (
        <span>{market.underlyingSymbol} — · distance to strike —</span>
      )}
    </p>
  );
}
