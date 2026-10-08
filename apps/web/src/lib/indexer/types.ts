/**
 * Market indexer interface — discovery over Meridian StrikeMarket (+ optional HTTP).
 */
import type { MarketView } from "@/lib/market/types";

/** `unavailable` = live reads failed off-localnet; fixtures are never used there (DLV-084). */
export type IndexerSource = "indexer-http" | "rpc-gpa" | "fixtures" | "unavailable";

export interface MarketListResult {
  markets: MarketView[];
  source: IndexerSource;
  /** True when fixtures were used because live sources failed/empty */
  usedFixtures: boolean;
  message?: string;
  /** Set when live reads failed and fixtures are not allowed (devnet/mainnet). */
  error?: string;
}

export interface FillHint {
  signature?: string;
  marketId: string;
  side?: "yes" | "no";
  price?: number;
  size?: number;
  ts?: number;
}

export interface PortfolioHints {
  marketIds: string[];
  note?: string;
}

export interface MeridianIndexer {
  listMarkets(nowSec?: number): Promise<MarketListResult>;
  getMarket(
    marketId: string,
    nowSec?: number,
  ): Promise<{ market: MarketView | null; source: IndexerSource; usedFixtures: boolean; error?: string }>;
  listFills?(wallet: string): Promise<FillHint[]>;
  getPortfolioHints?(wallet: string): Promise<PortfolioHints | null>;
}
