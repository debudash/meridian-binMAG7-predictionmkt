/**
 * Demo fixture portfolio when no indexer / token balances are available.
 * Used only for connected-wallet UI polish (badges, summary bar, constraint).
 * Not on-chain facts.
 */
import type { PositionSnapshot, OpenOrdersSnapshot } from "@/lib/intents/types";

const DAY = 86400;

export interface DemoPosition extends PositionSnapshot {
  marketId: string;
  side: "yes" | "no";
  avgEntry: number;
}

export interface DemoOpenOrder {
  id: string;
  marketId: string;
  marketLabel: string;
  intent: "buy-yes" | "sell-yes" | "buy-no" | "sell-no";
  price: number;
  size: number;
  filled: number;
  placedAt: number;
}

export interface DemoFill {
  id: string;
  sig: string;
  ts: number;
  type: "fill" | "settlement" | "redemption" | "cancel";
  marketId: string;
  marketLabel: string;
  intentOrOutcome: string;
  price?: number;
  size: number;
  amountUsdc?: number;
  feeUsdc?: number;
  realizedPnlUsdc?: number;
  side: "yes" | "no";
  makerOrTaker?: "maker" | "taker";
}

const DEMO_POSITIONS: DemoPosition[] = [
  {
    marketId: "fixture-aapl-230-oct16",
    side: "yes",
    yesQty: 40,
    noQty: 0,
    yesLockedInAsks: 0,
    avgEntry: 0.62,
  },
  {
    marketId: "fixture-nvda-140-soon",
    side: "no",
    yesQty: 0,
    noQty: 25,
    noLockedInOrders: 0,
    avgEntry: 0.48,
  },
];

export function getDemoPosition(marketId: string): PositionSnapshot {
  const row = DEMO_POSITIONS.find((p) => p.marketId === marketId);
  if (!row) return { yesQty: 0, noQty: 0 };
  return {
    yesQty: row.yesQty,
    noQty: row.noQty,
    yesLockedInAsks: row.yesLockedInAsks,
    noLockedInOrders: row.noLockedInOrders,
  };
}

export function getDemoOpenOrders(marketId?: string): OpenOrdersSnapshot {
  if (marketId === "fixture-msft-420") {
    return { openBuyYesQty: 15, openBuyNoQty: 0, openSellYesQty: 0, openSellNoQty: 0 };
  }
  return { openBuyYesQty: 0, openBuyNoQty: 0, openSellYesQty: 0, openSellNoQty: 0 };
}

export function listDemoPositions(): DemoPosition[] {
  return DEMO_POSITIONS;
}

export function listDemoOpenOrdersAcrossMarkets(): DemoOpenOrder[] {
  return [
    {
      id: "ord-1",
      marketId: "fixture-msft-420",
      marketLabel: "MSFT ≥ $420.00 · Oct 16",
      intent: "buy-yes",
      price: 0.52,
      size: 15,
      filled: 0,
      placedAt: Math.floor(Date.now() / 1000) - 3600,
    },
  ];
}

export function getDemoPortfolioSummary() {
  return {
    usdcAvailable: 1_250.4,
    unsettledPhoenixUsdc: 12.5,
    redeemableUsdc: 25,
  };
}

export function buildDemoHistory(nowSec = Math.floor(Date.now() / 1000)): DemoFill[] {
  return [
    {
      id: "h1",
      sig: "5xFixtureFillYesAapl0000000000000000000000000001",
      ts: nowSec - 7200,
      type: "fill",
      marketId: "fixture-aapl-230-oct16",
      marketLabel: "AAPL ≥ $230.00 · Oct 16",
      intentOrOutcome: "Buy Yes",
      price: 0.62,
      size: 40,
      amountUsdc: -24.8,
      feeUsdc: 0.05,
      side: "yes",
      makerOrTaker: "taker",
    },
    {
      id: "h2",
      sig: "5xFixtureFillNoNvda00000000000000000000000000002",
      ts: nowSec - 5400,
      type: "fill",
      marketId: "fixture-nvda-140-soon",
      marketLabel: "NVDA ≥ $140.00 · today",
      intentOrOutcome: "Buy No",
      price: 0.52,
      size: 25,
      amountUsdc: -13.0,
      feeUsdc: 0.03,
      side: "no",
      makerOrTaker: "maker",
    },
    {
      id: "h3",
      sig: "5xFixtureSettleTsla00000000000000000000000000003",
      ts: nowSec - DAY + 1200,
      type: "settlement",
      marketId: "fixture-tsla-250-settled",
      marketLabel: "TSLA ≥ $250.00 · Oct 3",
      intentOrOutcome: "Result: Yes",
      price: 251.3,
      size: 25,
      side: "yes",
    },
    {
      id: "h4",
      sig: "5xFixtureRedeemTsla0000000000000000000000000004",
      ts: nowSec - DAY + 1800,
      type: "redemption",
      marketId: "fixture-tsla-250-settled",
      marketLabel: "TSLA ≥ $250.00 · Oct 3",
      intentOrOutcome: "Yes",
      price: 1.0,
      size: 25,
      amountUsdc: 25.0,
      realizedPnlUsdc: 8.5,
      side: "yes",
    },
    {
      id: "h5",
      sig: "5xFixtureCancelMsft0000000000000000000000000005",
      ts: nowSec - 900,
      type: "cancel",
      marketId: "fixture-msft-420",
      marketLabel: "MSFT ≥ $420.00 · Oct 16",
      intentOrOutcome: "Cancel Buy Yes",
      price: 0.5,
      size: 10,
      side: "yes",
    },
  ];
}
