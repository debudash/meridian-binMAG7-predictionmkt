import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getMarketById } from "@/lib/market/fixtures";
import { TradeClient } from "./TradeClient";

type Props = {
  params: { marketId: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export function generateMetadata({ params }: Props): Metadata {
  const m = getMarketById(params.marketId);
  return {
    title: m ? `${m.underlyingSymbol} · Meridian` : "Market · Meridian",
    description: m?.question,
  };
}

export default function TradePage({ params, searchParams }: Props) {
  const market = getMarketById(params.marketId);
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
