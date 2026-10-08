"use client";

import { useChainClock } from "@/components/providers/AppProviders";
import { getCountdown } from "@/lib/market/countdown";
import type { MarketView } from "@/lib/market/types";

export function SettlementCountdown({
  market,
  compact = false,
}: {
  market: MarketView;
  compact?: boolean;
}) {
  const { nowSec } = useChainClock();
  const cd = getCountdown(market, nowSec);

  const color =
    cd.colorToken === "amber"
      ? "var(--amber)"
      : cd.colorToken === "green"
        ? "var(--green)"
        : cd.colorToken === "neutral-muted"
          ? "var(--text-muted)"
          : "var(--text)";

  return (
    <div
      title={`${cd.relativeLabel} · ${cd.absoluteLabel}`}
      style={{ color }}
      className={compact ? "chip" : "tabular"}
    >
      {compact ? (
        <span>{cd.state === "settled" ? cd.relativeLabel.split(" · ")[0] : cd.relativeLabel}</span>
      ) : (
        <div>
          <div style={{ fontWeight: 650, fontSize: "1.05rem" }}>{cd.relativeLabel}</div>
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: 2 }}>
            {cd.absoluteLabel}
          </div>
        </div>
      )}
    </div>
  );
}
