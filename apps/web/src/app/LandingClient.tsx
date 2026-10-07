"use client";

import { MarketCard } from "@/components/market/MarketCard";
import type { MarketView } from "@/lib/market/types";

export function LandingClient({
  featured,
  closingSoon,
  strip,
}: {
  featured?: MarketView;
  closingSoon?: MarketView[];
  strip?: boolean;
}) {
  if (strip && closingSoon) {
    if (closingSoon.length === 0) {
      return <p className="muted">No markets are open right now. Check back soon.</p>;
    }
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "1rem",
        }}
      >
        {closingSoon.map((m) => (
          <MarketCard key={m.marketId} market={m} />
        ))}
      </div>
    );
  }

  if (!featured) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          No markets are open right now. Check back soon.
        </p>
      </div>
    );
  }

  return <MarketCard market={featured} />;
}
