/**
 * Demo fixture portfolio — LOCALNET FIXTURE MODE ONLY (DLV-088).
 * Shown only when the app is displaying fixture markets on a localnet-style cluster
 * (lib/portfolio/demoMode). Devnet/mainnet and real localnet markets use on-chain reads.
 * Not on-chain facts.
 */
import type { PositionSnapshot, OpenOrdersSnapshot } from "@/lib/intents/types";
import type { MarketView } from "@/lib/market/types";
import type { Portfolio } from "@/lib/portfolio/account";

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

/** Demo rows in the real Portfolio shape (fixture markets only; no on-chain accounts). */
export function buildDemoPortfolio(markets: readonly MarketView[]): Portfolio {
  const byId = new Map(markets.map((m) => [m.marketId, m]));
  const positions: Portfolio["positions"] = [];
  for (const p of DEMO_POSITIONS) {
    const market = byId.get(p.marketId);
    if (!market || market.status !== "open") continue;
    const ym = market.yesMid ?? market.lastYes ?? p.avgEntry;
    const qty = p.side === "yes" ? p.yesQty : p.noQty;
    const mark = p.side === "yes" ? ym : 1 - ym;
    positions.push({
      market,
      side: p.side,
      qty,
      yesQty: p.yesQty,
      noQty: p.noQty,
      inSeat: 0,
      mark,
      value: qty * mark,
    });
  }
  const orders: Portfolio["orders"] = [];
  for (const o of listDemoOpenOrdersAcrossMarkets()) {
    const market = byId.get(o.marketId);
    if (!market) continue;
    orders.push({
      id: o.id,
      side: o.intent === "buy-yes" || o.intent === "sell-no" ? "bid" : "ask",
      price: o.price,
      size: o.size - o.filled,
      priceInTicks: "0",
      orderSequenceNumber: "0",
      intent: o.intent,
      intentPrice: o.price,
      market,
    });
  }
  const redeemable: Portfolio["redeemable"] = markets
    .filter((m) => m.status === "settled-yes" || m.status === "settled-no")
    .map((m) => ({
      marketId: m.marketId,
      label: m.question,
      side: m.status === "settled-yes" ? ("yes" as const) : ("no" as const),
      size: 25,
      payoutUsdc: 25,
    }));
  const summary = getDemoPortfolioSummary();
  return {
    positions,
    orders,
    seats: [],
    redeemable,
    totals: {
      usdc: summary.usdcAvailable,
      seatUsdcFree: 0,
      redeemableUsdc: redeemable.reduce((s, r) => s + r.payoutUsdc, 0),
      positionsValue: positions.reduce((s, r) => s + r.value, 0),
    },
  };
}
