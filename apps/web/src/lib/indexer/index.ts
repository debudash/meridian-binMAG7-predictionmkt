/**
 * Meridian market discovery — prefer HTTP indexer, then RPC GPA.
 * Fixture markets are a fallback on localnet/dev clusters ONLY (DLV-084); on devnet/mainnet a
 * failed read returns an error state and an empty read returns an empty state.
 */
import {
  buildFixtureMarkets,
  getMarketById as getFixtureMarketById,
} from "@/lib/market/fixtures";
import type { MarketView } from "@/lib/market/types";
import { fixturesAllowed, getCluster, getIndexerUrl } from "@/lib/solana/config";
import {
  httpGetMarket,
  httpListFills,
  httpListMarkets,
  httpPortfolioHints,
  isHttpIndexerConfigured,
} from "./http";
import { fetchMarketViaRpc, fetchMarketsViaRpc } from "./rpc";
import { errorMessage, logChainReadError, warnChainReadOnce } from "@/lib/log/chainRead";
import { createTtlCache, marketListCacheTtl } from "./listCache";
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

type LiveList =
  | { markets: MarketView[]; source: "indexer-http" | "rpc-gpa"; failed: false }
  | { markets: []; source: "rpc-gpa"; failed: true; detail: string };

async function readLiveUncached(): Promise<LiveList> {
  if (isHttpIndexerConfigured()) {
    const http = await httpListMarkets();
    if (http && http.length > 0) {
      return { markets: http, source: "indexer-http", failed: false };
    }
  }
  try {
    const rpc = await fetchMarketsViaRpc();
    return { markets: rpc, source: "rpc-gpa", failed: false };
  } catch (e) {
    // DLV-090: never swallow — the cause must be visible in server logs on every cluster.
    logChainReadError("indexer.listMarkets", e, { cluster: getCluster() });
    return { markets: [], source: "rpc-gpa", failed: true, detail: errorMessage(e) };
  }
}

// M4 / L10: one cached market scan shared by listMarkets, /api/markets and getMarket misses.
const liveCache = createTtlCache(readLiveUncached, {
  get ttlMs() {
    return marketListCacheTtl().ttlMs;
  },
  get failureTtlMs() {
    return marketListCacheTtl().failureTtlMs;
  },
});

function readLive(): Promise<LiveList> {
  return liveCache.get();
}

/** Tests / ops: drop the cached market scan. */
export function resetMarketListCache(): void {
  liveCache.reset();
}

async function listFromLive(): Promise<{
  markets: MarketView[];
  source: "indexer-http" | "rpc-gpa";
} | null> {
  const live = await readLive();
  return !live.failed && live.markets.length > 0 ? live : null;
}

function unavailableMessage(cluster: string): string {
  return `Couldn't load markets from Solana ${cluster} right now (RPC unavailable). Try again in a moment.`;
}

export async function listMarkets(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<MarketListResult> {
  const live = await readLive();
  if (!live.failed && live.markets.length > 0) {
    return { markets: live.markets, source: live.source, usedFixtures: false };
  }
  if (fixturesAllowed()) {
    warnChainReadOnce(
      "indexer.listMarkets",
      `serving fixture markets on ${getCluster()}: ${
        live.failed ? `live read failed (${live.detail})` : "no StrikeMarket accounts found"
      }`,
    );
    return {
      markets: buildFixtureMarkets(nowSec),
      source: "fixtures",
      usedFixtures: true,
      message: FIXTURE_BANNER,
    };
  }
  const cluster = getCluster();
  if (live.failed) {
    return { markets: [], source: "unavailable", usedFixtures: false, error: unavailableMessage(cluster) };
  }
  return {
    markets: [],
    source: live.source,
    usedFixtures: false,
    message: `No markets on Solana ${cluster} yet.`,
  };
}

export async function getMarket(
  marketId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{
  market: MarketView | null;
  source: MarketListResult["source"];
  usedFixtures: boolean;
  error?: string;
}> {
  if (isHttpIndexerConfigured()) {
    const http = await httpGetMarket(marketId);
    if (http) {
      return { market: http, source: "indexer-http", usedFixtures: false };
    }
  }
  let rpcFailed = false;
  try {
    const rpc = await fetchMarketViaRpc(marketId);
    if (rpc) {
      return { market: rpc, source: "rpc-gpa", usedFixtures: false };
    }
  } catch (e) {
    rpcFailed = true;
    logChainReadError("indexer.getMarket", e, { cluster: getCluster(), marketId });
  }
  // Prefer live list match (HTTP list may have succeeded even if /markets/:id 404)
  const live = await readLive();
  if (!live.failed) {
    const found = live.markets.find((m) => m.marketId === marketId) ?? null;
    if (found) {
      return { market: found, source: live.source, usedFixtures: false };
    }
  }
  if (fixturesAllowed()) {
    const fixture = getFixtureMarketById(marketId, nowSec) ?? null;
    if (fixture && (rpcFailed || live.failed)) {
      warnChainReadOnce("indexer.getMarket", `serving fixture ${marketId} on ${getCluster()}: live read failed`);
    }
    return { market: fixture, source: "fixtures", usedFixtures: true };
  }
  if (rpcFailed && live.failed) {
    const cluster = getCluster();
    return {
      market: null,
      source: "unavailable",
      usedFixtures: false,
      error: `Couldn't load this market from Solana ${cluster} right now (RPC unavailable). Try again in a moment.`,
    };
  }
  return { market: null, source: live.source, usedFixtures: false };
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
