/**
 * Mock market fixtures for SSR when no indexer is configured.
 * Not on-chain facts — Schema TODOs remain open for registry discovery.
 */
import type { MarketView, OrderBookSnapshot } from "./types";

const DAY = 86400;

/** Fixed "now" reference for deterministic SSR demos — overridden at runtime. */
export function buildFixtureMarkets(nowSec = Math.floor(Date.now() / 1000)): MarketView[] {
  return [
    {
      marketId: "fixture-aapl-230-oct16",
      question: "Will AAPL close at or above $230.00 on Oct 16, 2026?",
      underlyingSymbol: "AAPL",
      strike: 230,
      comparator: ">=",
      tradingCloseTs: nowSec + 2 * DAY + 4 * 3600,
      settleTs: nowSec + 2 * DAY + 4 * 3600 + 900,
      status: "open",
      yesMid: 0.62,
      yesBid: 0.61,
      yesAsk: 0.63,
      lastYes: 0.62,
      volume24hUsdc: 128_400,
      openInterest: 4200,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 228.14,
      underlyingPublishTs: nowSec - 12,
      phoenixMarket: undefined, // TODO(schema): wire when set_phoenix_market
    },
    {
      marketId: "fixture-nvda-140-soon",
      question: "Will NVDA close at or above $140.00 today?",
      underlyingSymbol: "NVDA",
      strike: 140,
      comparator: ">=",
      tradingCloseTs: nowSec + 42 * 60,
      settleTs: nowSec + 42 * 60 + 600,
      status: "open",
      yesMid: 0.48,
      yesBid: 0.47,
      yesAsk: 0.49,
      lastYes: 0.48,
      volume24hUsdc: 89_200,
      openInterest: 3100,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 139.2,
      underlyingPublishTs: nowSec - 8,
    },
    {
      marketId: "fixture-tsla-250-settled",
      question: "Will TSLA close at or above $250.00 on Oct 3, 2026?",
      underlyingSymbol: "TSLA",
      strike: 250,
      comparator: ">=",
      tradingCloseTs: nowSec - DAY,
      settleTs: nowSec - DAY + 900,
      status: "settled-yes",
      outcome: "yes",
      resolvedPrice: 251.3,
      resolvedAt: nowSec - DAY + 1200,
      yesMid: 1,
      lastYes: 0.97,
      volume24hUsdc: 44_000,
      openInterest: 0,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 251.3,
    },
    {
      marketId: "fixture-msft-420",
      question: "Will MSFT close at or above $420.00 on Oct 16, 2026?",
      underlyingSymbol: "MSFT",
      strike: 420,
      comparator: ">=",
      tradingCloseTs: nowSec + 5 * DAY,
      settleTs: nowSec + 5 * DAY + 900,
      status: "open",
      yesMid: 0.55,
      yesBid: 0.54,
      yesAsk: 0.56,
      lastYes: 0.55,
      volume24hUsdc: 62_100,
      openInterest: 1800,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 418.5,
      underlyingPublishTs: nowSec - 20,
    },
  ];
}

export function fixtureBook(market: MarketView): OrderBookSnapshot {
  const mid = market.yesMid ?? 0.5;
  const tick = market.tickSize;
  const bids = Array.from({ length: 8 }, (_, i) => ({
    price: Math.round((mid - tick * (i + 1)) * 100) / 100,
    size: 40 + i * 12,
  })).filter((l) => l.price >= market.minPrice);
  const asks = Array.from({ length: 8 }, (_, i) => ({
    price: Math.round((mid + tick * (i + 1)) * 100) / 100,
    size: 35 + i * 10,
  })).filter((l) => l.price <= market.maxPrice);
  return { bids, asks, sequence: 1, updatedAt: Date.now() };
}

export function getMarketById(
  marketId: string,
  nowSec = Math.floor(Date.now() / 1000),
): MarketView | undefined {
  return buildFixtureMarkets(nowSec).find((m) => m.marketId === marketId);
}
