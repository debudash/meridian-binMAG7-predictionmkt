/**
 * Optional HTTP indexer client when NEXT_PUBLIC_INDEXER_URL is set.
 * Expected endpoints (minimal):
 *   GET /markets → MarketView[] | { markets: MarketView[] }
 *   GET /markets/:id → MarketView | { market: MarketView }
 *   GET /fills?wallet= → FillHint[] (optional)
 *   GET /portfolio?wallet= → PortfolioHints (optional)
 */
import type { MarketView } from "@/lib/market/types";
import type { FillHint, PortfolioHints } from "./types";

function baseUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_INDEXER_URL;
  if (!u || !u.trim()) return null;
  return u.replace(/\/$/, "");
}

async function getJson<T>(path: string): Promise<T | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      next: { revalidate: 15 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function isHttpIndexerConfigured(): boolean {
  return Boolean(baseUrl());
}

export async function httpListMarkets(): Promise<MarketView[] | null> {
  const data = await getJson<MarketView[] | { markets: MarketView[] }>("/markets");
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.markets)) return data.markets;
  return null;
}

export async function httpGetMarket(marketId: string): Promise<MarketView | null> {
  const data = await getJson<MarketView | { market: MarketView }>(
    `/markets/${encodeURIComponent(marketId)}`,
  );
  if (!data) return null;
  if ("marketId" in data && (data as MarketView).marketId) return data as MarketView;
  if ("market" in data && data.market) return data.market;
  return null;
}

export async function httpListFills(wallet: string): Promise<FillHint[] | null> {
  const data = await getJson<FillHint[] | { fills: FillHint[] }>(
    `/fills?wallet=${encodeURIComponent(wallet)}`,
  );
  if (!data) return null;
  if (Array.isArray(data)) return data;
  return data.fills ?? null;
}

export async function httpPortfolioHints(
  wallet: string,
): Promise<PortfolioHints | null> {
  return getJson<PortfolioHints>(
    `/portfolio?wallet=${encodeURIComponent(wallet)}`,
  );
}
