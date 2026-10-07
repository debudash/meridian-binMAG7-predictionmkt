import { MarketsClient } from "./MarketsClient";
import { listMarkets } from "@/lib/indexer";

// Live chain data (RPC/Phoenix) — never serve cached fetches.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function MarketsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const { markets, usedFixtures, message, source } = await listMarkets(nowSec);
  const statusParam = typeof searchParams?.status === "string" ? searchParams.status : "open";
  const q = typeof searchParams?.q === "string" ? searchParams.q : "";
  const sort = typeof searchParams?.sort === "string" ? searchParams.sort : "close";
  const view = typeof searchParams?.view === "string" ? searchParams.view : "cards";
  const u = typeof searchParams?.u === "string" ? searchParams.u : "";
  const expiry = typeof searchParams?.expiry === "string" ? searchParams.expiry : "";

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
        initialView={view}
        initialUnderlyings={u}
        initialExpiry={expiry}
        dataSource={source}
        fixtureBanner={usedFixtures ? message : undefined}
      />
    </div>
  );
}
