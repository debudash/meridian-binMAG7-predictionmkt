import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getMarket } from "@/lib/indexer";
import { TradeClient } from "./TradeClient";

type Props = {
  params: { marketId: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market: m } = await getMarket(params.marketId);
  return {
    title: m ? `${m.underlyingSymbol} · Meridian` : "Market · Meridian",
    description: m?.question,
  };
}

export default async function TradePage({ params, searchParams }: Props) {
  const { market, usedFixtures, source } = await getMarket(params.marketId);
  if (!market) notFound();

  const intent =
    typeof searchParams?.intent === "string" ? searchParams.intent : undefined;
  const side =
    typeof searchParams?.side === "string" ? searchParams.side : undefined;
  const price =
    typeof searchParams?.price === "string"
      ? Number(searchParams.price)
      : undefined;
  const size =
    typeof searchParams?.size === "string"
      ? Number(searchParams.size)
      : undefined;

  return (
    <div className="container">
      {usedFixtures && (
        <div className="banner" style={{ marginBottom: "1rem", borderRadius: 8 }}>
          Fixture market data (source={source}). Live indexer/RPC returned no match.
        </div>
      )}
      <Suspense fallback={<div className="card">Loading trade…</div>}>
        <TradeClient
          market={market}
          initialIntent={intent}
          initialSide={side}
          initialPrice={Number.isFinite(price) ? price : undefined}
          initialSize={Number.isFinite(size) ? size : undefined}
        />
      </Suspense>
    </div>
  );
}
