/**
 * Meridian market discovery — prefer HTTP indexer, then RPC GPA, else fixtures.
 */
import {
  buildFixtureMarkets,
  getMarketById as getFixtureMarketById,
} from "@/lib/market/fixtures";
import type { MarketView } from "@/lib/market/types";
import { getIndexerUrl } from "@/lib/solana/config";
import {
  httpGetMarket,
  httpListFills,
  httpListMarkets,
  httpPortfolioHints,
  isHttpIndexerConfigured,
} from "./http";
import { fetchMarketViaRpc, fetchMarketsViaRpc } from "./rpc";
import type {
  FillHint,
  MarketListResult,
  MeridianIndexer,
  PortfolioHints,
} from "./types";

export type { MeridianIndexer, MarketListResult, FillHint, PortfolioHints };
export { mapStrikeMarketToView } from "./mapStrikeMarket";

const FIXTURE_BANNER =
  "Showing fixture markets (indexer/RPC unavailable or empty). Configure NEXT_PUBLIC_INDEXER_URL or a reachable Solana RPC with StrikeMarket accounts.";

async function listFromLive(): Promise<{
  markets: MarketView[];
  source: "indexer-http" | "rpc-gpa";
} | null> {
  if (isHttpIndexerConfigured()) {
    const http = await httpListMarkets();
    if (http && http.length > 0) {
      return { markets: http, source: "indexer-http" };
    }
  }
  try {
    const rpc = await fetchMarketsViaRpc();
    if (rpc.length > 0) {
      return { markets: rpc, source: "rpc-gpa" };
    }
  } catch {
    // fall through to fixtures
  }
  return null;
}

export async function listMarkets(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<MarketListResult> {
  const live = await listFromLive();
  if (live) {
    return {
      markets: live.markets,
      source: live.source,
      usedFixtures: false,
    };
  }
  return {
    markets: buildFixtureMarkets(nowSec),
    source: "fixtures",
    usedFixtures: true,
    message: FIXTURE_BANNER,
  };
}

export async function getMarket(
  marketId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{
  market: MarketView | null;
  source: MarketListResult["source"];
  usedFixtures: boolean;
}> {
  if (isHttpIndexerConfigured()) {
    const http = await httpGetMarket(marketId);
    if (http) {
      return { market: http, source: "indexer-http", usedFixtures: false };
    }
  }
  try {
    const rpc = await fetchMarketViaRpc(marketId);
    if (rpc) {
      return { market: rpc, source: "rpc-gpa", usedFixtures: false };
    }
  } catch {
    // continue
  }
  // Prefer live list match (HTTP list may have succeeded even if /markets/:id 404)
  const live = await listFromLive();
  if (live) {
    const found = live.markets.find((m) => m.marketId === marketId) ?? null;
    if (found) {
      return { market: found, source: live.source, usedFixtures: false };
    }
  }
  const fixture = getFixtureMarketById(marketId, nowSec) ?? null;
  return {
    market: fixture,
    source: "fixtures",
    usedFixtures: true,
  };
}

export async function listFills(wallet: string): Promise<FillHint[]> {
  if (!getIndexerUrl()) return [];
  return (await httpListFills(wallet)) ?? [];
}

export async function getPortfolioHints(
  wallet: string,
): Promise<PortfolioHints | null> {
  if (!getIndexerUrl()) return null;
  return httpPortfolioHints(wallet);
}

/** Default indexer implementation matching MeridianIndexer. */
export const defaultIndexer: MeridianIndexer = {
  listMarkets,
  getMarket,
  listFills,
  getPortfolioHints,
};
