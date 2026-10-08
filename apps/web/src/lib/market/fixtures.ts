/**
 * Mock market fixtures for SSR when no indexer is configured.
 * Not on-chain facts — Schema TODOs remain open for registry discovery.
 */
import type { MarketView, OrderBookSnapshot } from "./types";

const DAY = 86400;

/** Fixed "now" reference for deterministic SSR demos — overridden at runtime. */
export function buildFixtureMarkets(nowSec = Math.floor(Date.now() / 1000)): MarketView[] {
  const aaplClose = nowSec + 2 * DAY + 4 * 3600;
  const aaplSettle = aaplClose + 900;
  return [
    {
      marketId: "fixture-aapl-225-oct16",
      question: "Will AAPL close at or above $225.00 on Oct 16, 2026?",
      underlyingSymbol: "AAPL",
      strike: 225,
      comparator: ">=",
      tradingCloseTs: aaplClose,
      settleTs: aaplSettle,
      status: "open",
      yesMid: 0.72,
      yesBid: 0.71,
      yesAsk: 0.73,
      lastYes: 0.72,
      volume24hUsdc: 98_200,
      openInterest: 2800,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 228.14,
      underlyingPublishTs: nowSec - 12,
    },
    {
      marketId: "fixture-aapl-230-oct16",
      question: "Will AAPL close at or above $230.00 on Oct 16, 2026?",
      underlyingSymbol: "AAPL",
      strike: 230,
      comparator: ">=",
      tradingCloseTs: aaplClose,
      settleTs: aaplSettle,
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
      marketId: "fixture-aapl-235-oct16",
      question: "Will AAPL close at or above $235.00 on Oct 16, 2026?",
      underlyingSymbol: "AAPL",
      strike: 235,
      comparator: ">=",
      tradingCloseTs: aaplClose,
      settleTs: aaplSettle,
      status: "open",
      yesMid: 0.41,
      yesBid: 0.4,
      yesAsk: 0.42,
      lastYes: 0.41,
      volume24hUsdc: 71_000,
      openInterest: 1900,
      tickSize: 0.01,
      lotSize: 1,
      minPrice: 0.01,
      maxPrice: 0.99,
      underlyingPrice: 228.14,
      underlyingPublishTs: nowSec - 12,
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

/**
 * Book to render: the live Phoenix ladder when we have one; otherwise the fixture ladder only
 * where fixtures are allowed (localnet/dev, DLV-084), else an empty book.
 */
export function displayBook(
  liveBook: OrderBookSnapshot | null,
  market: MarketView,
  allowFixtures: boolean,
): OrderBookSnapshot {
  if (liveBook) return liveBook;
  if (allowFixtures) return fixtureBook(market);
  return { bids: [], asks: [], sequence: 0, updatedAt: Date.now() };
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

/** Expiry chip label from tradingCloseTs (America/Chicago date). */
export function expiryChipLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}

/** Stable expiry key for filter chips (YYYY-MM-DD CT). */
export function expiryKey(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}
