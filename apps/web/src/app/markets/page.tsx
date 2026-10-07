import { MarketsClient } from "./MarketsClient";
import { buildFixtureMarkets } from "@/lib/market/fixtures";

export default function MarketsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const markets = buildFixtureMarkets(nowSec);
  const statusParam = typeof searchParams?.status === "string" ? searchParams.status : "open";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const sort = typeof searchParams?.sort === "string" ? searchParams.sort : "close";

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Markets</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        One book per market — Yes and No are two prices on the same Phoenix book.
      </p>
      <MarketsClient
        markets={markets}
        initialStatus={statusParam}
        initialQuery={q}
        initialSort={sort}
      />
    </div>
  );
}
