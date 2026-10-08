/**
 * DLV-088 / DLV-087 / DLV-068 — the opposite-side rule and Portfolio come from real balances:
 * wallet Yes/No + Phoenix seat (free Yes counts as held) + resting orders (resting buys count).
 */
import { describe, expect, it } from "vitest";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import type { MarketView } from "@/lib/market/types";
import {
  availabilityInputs,
  buildPortfolio,
  labelOrders,
  type MarketAccountState,
} from "./account";
import type { PhoenixOpenOrder, PhoenixTraderSnapshot } from "./phoenixTrader";

const OPEN = { lifecycle: "open" as const, lotSize: 1 };
const NONE = { pendingTradeCount: 0 };
const bid = (price: number, size: number, n = 1): PhoenixOpenOrder => ({
  id: `bid:${n}`, side: "bid", price, size, priceInTicks: String(price * 100), orderSequenceNumber: String(n),
});
const ask = (price: number, size: number, n = 2): PhoenixOpenOrder => ({
  id: `ask:${n}`, side: "ask", price, size, priceInTicks: String(price * 100), orderSequenceNumber: String(n),
});
const phx = (seat: Partial<PhoenixTraderSnapshot["seat"]>, orders: PhoenixOpenOrder[] = []): PhoenixTraderSnapshot => ({
  phoenixMarket: "PHX1",
  seat: { yesFree: 0, yesLocked: 0, usdcFree: 0, usdcLocked: 0, ...seat },
  orders,
});
const st = (yes: number, no: number, phoenix: PhoenixTraderSnapshot | null = null): MarketAccountState => ({
  marketId: "M1",
  wallet: { yes, no },
  phoenix,
});
const avail = (s: MarketAccountState) => {
  const { position, openOrders } = availabilityInputs(s);
  return getIntentAvailability(position, openOrders, NONE, OPEN);
};

describe("labelOrders — intent of a resting Yes/USDC order", () => {
  it("bid with no No in wallet = resting Buy Yes; ask with no No = Sell Yes", () => {
    const l = labelOrders(st(0, 0, phx({}, [bid(0.45, 6), ask(0.6, 2)])));
    expect(l.map((o) => [o.intent, o.intentPrice])).toEqual([["buy-yes", 0.45], ["sell-yes", 0.6]]);
  });
  it("ask while holding No (mint + ask) = resting Buy No at 1 − p; bid while holding No = Sell No", () => {
    const l = labelOrders(st(0, 10, phx({ yesLocked: 10 }, [ask(0.55, 10), bid(0.3, 4)])));
    expect(l.map((o) => [o.intent, o.intentPrice])).toEqual([["buy-no", 0.45], ["sell-no", 0.7]]);
  });
});

describe("availabilityInputs → opposite-side rule", () => {
  it("wallet only (unchanged behaviour): Yes held blocks Buy No", () => {
    expect(avail(st(5, 0))["buy-no"].enabled).toBe(false);
    expect(avail(st(0, 0))["buy-no"].enabled).toBe(true);
  });

  it("DLV-087: Yes stuck in the Phoenix seat counts as held — blocks Buy No and is sellable", () => {
    const a = avail(st(0, 0, phx({ yesFree: 4 })));
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].copy).toMatch(/4 Yes/);
    expect(a["sell-yes"].enabled).toBe(true);
  });

  it("DLV-068: a resting Buy Yes blocks Buy No (cancel first)", () => {
    const a = avail(st(0, 0, phx({ usdcLocked: 2.7 }, [bid(0.45, 6)])));
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].copy).toMatch(/open Buy Yes orders \(6/i);
    expect(a["buy-yes"].enabled).toBe(true);
  });

  it("DLV-068: a resting Buy No (No in wallet, Yes locked in the ask) blocks Buy Yes, not Buy No", () => {
    const a = avail(st(0, 10, phx({ yesLocked: 10 }, [ask(0.55, 10)])));
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(true);
  });

  it("Yes locked in a resting Sell Yes is being sold — not counted as held, not re-sellable", () => {
    const { position } = availabilityInputs(st(0, 0, phx({ yesLocked: 3 }, [ask(0.6, 3)])));
    expect(position.yesQty).toBe(0);
    const a = avail(st(0, 0, phx({ yesLocked: 3 }, [ask(0.6, 3)])));
    expect(a["sell-yes"].enabled).toBe(false);
  });

  it("No committed to a resting Sell No bid can't be sold twice", () => {
    const a = avail(st(0, 4, phx({ usdcLocked: 1.2 }, [bid(0.3, 4)])));
    expect(a["sell-no"].enabled).toBe(false);
    expect(a["buy-yes"].enabled).toBe(false); // still holds No
  });

  it("seat Yes + wallet No (resting Sell No filled) = both sides → can sell either, add to neither", () => {
    const a = avail(st(0, 4, phx({ yesFree: 4 })));
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["sell-yes"].enabled).toBe(true);
  });
});

const mk = (id: string, over: Partial<MarketView> = {}): MarketView => ({
  marketId: id,
  question: `${id} ≥ $100?`,
  underlyingSymbol: "NVDA",
  strike: 100,
  comparator: ">=",
  tradingCloseTs: 2_000_000_000,
  settleTs: 2_000_000_000,
  status: "open",
  yesMint: `${id}-yes`,
  noMint: `${id}-no`,
  collateralVault: `${id}-vault`,
  treasury: "TREAS",
  phoenixMarket: `${id}-phx`,
  yesMid: 0.6,
  tickSize: 0.01,
  lotSize: 1,
  minPrice: 0.01,
  maxPrice: 0.99,
  ...over,
});

describe("buildPortfolio", () => {
  const markets = [
    mk("OPENYES"),
    mk("OPENNO", { yesMid: 0.3 }),
    mk("FLAT"),
    mk("WONYES", { status: "settled-yes", outcome: "yes" }),
    mk("LOSTNO", { status: "settled-yes", outcome: "yes" }),
    mk("WONNO", { status: "settled-no", outcome: "no" }),
  ];
  const states = new Map<string, MarketAccountState>([
    ["OPENYES", { marketId: "OPENYES", wallet: { yes: 10, no: 0 }, phoenix: phx({ yesFree: 4, usdcFree: 1.5 }, [bid(0.45, 6)]) }],
    ["OPENNO", { marketId: "OPENNO", wallet: { yes: 0, no: 25 }, phoenix: null }],
    ["FLAT", { marketId: "FLAT", wallet: { yes: 0, no: 0 }, phoenix: phx({}) }],
    ["WONYES", { marketId: "WONYES", wallet: { yes: 7, no: 0 }, phoenix: phx({ yesFree: 2 }) }],
    ["LOSTNO", { marketId: "LOSTNO", wallet: { yes: 0, no: 3 }, phoenix: null }],
    ["WONNO", { marketId: "WONNO", wallet: { yes: 0, no: 5 }, phoenix: null }],
  ]);
  const p = buildPortfolio(markets, states, 100);

  it("positions = open markets with exposure (wallet + seat Yes), marked at the Yes mid", () => {
    expect(p.positions.map((r) => [r.market.marketId, r.side, r.qty, r.inSeat])).toEqual([
      ["OPENYES", "yes", 14, 4],
      ["OPENNO", "no", 25, 0],
    ]);
    expect(p.positions[0].mark).toBeCloseTo(0.6);
    expect(p.positions[1].mark).toBeCloseTo(0.7);
    expect(p.positions[1].value).toBeCloseTo(17.5);
  });

  it("orders = every resting order with its market and intent", () => {
    expect(p.orders.map((o) => [o.market.marketId, o.intent, o.size])).toEqual([["OPENYES", "buy-yes", 6]]);
  });

  it("seats = markets with anything in the Phoenix trader account", () => {
    expect(p.seats.map((s) => [s.market.marketId, s.yesFree, s.usdcFree])).toEqual([
      ["OPENYES", 4, 1.5],
      ["WONYES", 2, 0],
    ]);
  });

  it("redeemable = winning-side WALLET balance on settled markets, with on-chain accounts", () => {
    expect(p.redeemable).toEqual([
      expect.objectContaining({ marketId: "WONYES", side: "yes", size: 7, payoutUsdc: 7, strikeMarket: "WONYES", winningMint: "WONYES-yes", collateralVault: "WONYES-vault", treasury: "TREAS" }),
      expect.objectContaining({ marketId: "WONNO", side: "no", size: 5, payoutUsdc: 5, winningMint: "WONNO-no" }),
    ]);
  });

  it("totals: USDC wallet, seat USDC, redeemable, positions value", () => {
    expect(p.totals.usdc).toBe(100);
    expect(p.totals.seatUsdcFree).toBeCloseTo(1.5);
    expect(p.totals.redeemableUsdc).toBe(12);
    expect(p.totals.positionsValue).toBeCloseTo(14 * 0.6 + 25 * 0.7);
  });

  it("no wallet data → empty portfolio (never demo data)", () => {
    const e = buildPortfolio(markets, new Map(), null);
    expect(e.positions).toEqual([]);
    expect(e.redeemable).toEqual([]);
    expect(e.totals.usdc).toBeNull();
  });
});
