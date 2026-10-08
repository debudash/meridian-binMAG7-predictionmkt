/**
 * Real wallet account state → availability inputs + Portfolio (DLV-088, DLV-087, DLV-068).
 *
 * Sources per market: wallet Yes/No token balances and the wallet's Phoenix trader account
 * (seat balances + resting orders). No demo data here — callers decide demo mode separately.
 *
 * Opposite-side rule inputs:
 *   Yes held  = wallet Yes + seat free Yes (fills of resting buys sit in the seat)
 *   No held   = wallet No (Phoenix books are Yes/USDC, No never sits in a seat)
 *   resting bid, no No in wallet → open Buy Yes (counts toward Yes exposure)
 *   resting bid, No in wallet    → Sell No (No committed → not sellable twice)
 *   resting ask, No in wallet    → Buy No (mint + ask; No already counted as held)
 *   resting ask, no No           → Sell Yes (locked Yes is being sold → not counted as held)
 */
import type { Intent, OpenOrdersSnapshot, PositionSnapshot } from "@/lib/intents/types";
import type { MarketView } from "@/lib/market/types";
import type { PhoenixOpenOrder, PhoenixTraderSnapshot } from "./phoenixTrader";

export interface WalletBalances {
  yes: number;
  no: number;
}

export interface MarketAccountState {
  marketId: string;
  wallet: WalletBalances;
  /** null = no Phoenix seat on this market (or no book) — or a failed read when `phoenixReadFailed` */
  phoenix: PhoenixTraderSnapshot | null;
  /**
   * L7 (review mr72-73): the Phoenix market account was requested but couldn't be read (missing
   * account or decode error). `phoenix` is then null for lack of data, not because the seat is empty.
   */
  phoenixReadFailed?: true;
}

export interface LabelledOrder extends PhoenixOpenOrder {
  intent: Intent;
  /** Price in the intent's own terms (No intents quote 1 − Yes) */
  intentPrice: number;
}

export interface RedeemableRow {
  marketId: string;
  label: string;
  side: "yes" | "no";
  size: number;
  payoutUsdc: number;
  /** On-chain accounts — required to submit redeem */
  strikeMarket?: string;
  collateralVault?: string;
  winningMint?: string;
  treasury?: string;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function labelOrders(state: MarketAccountState): LabelledOrder[] {
  const holdsNo = state.wallet.no > 0;
  return (state.phoenix?.orders ?? []).map((o) => {
    let intent: Intent;
    if (o.side === "bid") intent = holdsNo ? "sell-no" : "buy-yes";
    else intent = holdsNo ? "buy-no" : "sell-yes";
    const noTerms = intent === "buy-no" || intent === "sell-no";
    return { ...o, intent, intentPrice: noTerms ? round6(1 - o.price) : o.price };
  });
}

export function availabilityInputs(state: MarketAccountState): {
  position: PositionSnapshot;
  openOrders: OpenOrdersSnapshot;
} {
  const seat = state.phoenix?.seat;
  const yesQty = round6(state.wallet.yes + (seat?.yesFree ?? 0));
  const noQty = state.wallet.no;
  const sum = (intent: Intent) =>
    round6(labelOrders(state).filter((o) => o.intent === intent).reduce((s, o) => s + o.size, 0));
  const openSellNoQty = sum("sell-no");
  return {
    position: {
      yesQty,
      noQty,
      noLockedInOrders: Math.min(noQty, openSellNoQty),
    },
    openOrders: {
      openBuyYesQty: sum("buy-yes"),
      openBuyNoQty: sum("buy-no"),
      openSellYesQty: sum("sell-yes"),
      openSellNoQty,
    },
  };
}

export interface PositionRow {
  market: MarketView;
  side: "yes" | "no" | "both";
  /** Contracts held on `side` (wallet + seat free); for "both" the Yes quantity */
  qty: number;
  yesQty: number;
  noQty: number;
  /** Of which sitting in the Phoenix seat (withdraw to wallet) */
  inSeat: number;
  /** Side mark 0–1 (Yes mid, or 1 − mid for No) */
  mark: number;
  value: number;
}

export interface OrderRow extends LabelledOrder {
  market: MarketView;
}

export interface SeatRow {
  market: MarketView;
  phoenixMarket: string;
  yesFree: number;
  yesLocked: number;
  usdcFree: number;
  usdcLocked: number;
}

export interface Portfolio {
  positions: PositionRow[];
  orders: OrderRow[];
  seats: SeatRow[];
  redeemable: RedeemableRow[];
  totals: {
    /** Wallet USDC (null when unknown) */
    usdc: number | null;
    seatUsdcFree: number;
    redeemableUsdc: number;
    positionsValue: number;
  };
}

function yesMark(m: MarketView): number {
  return m.yesMid ?? m.lastYes ?? 0.5;
}

/** Winning-side wallet balances on settled markets (seat Yes must be withdrawn first). */
export function redeemableRows(
  markets: readonly MarketView[],
  states: ReadonlyMap<string, MarketAccountState>,
): RedeemableRow[] {
  const out: RedeemableRow[] = [];
  for (const m of markets) {
    if (m.status !== "settled-yes" && m.status !== "settled-no") continue;
    const s = states.get(m.marketId);
    if (!s) continue;
    const side = m.status === "settled-yes" ? "yes" : "no";
    const size = side === "yes" ? s.wallet.yes : s.wallet.no;
    if (size <= 0) continue;
    out.push({
      marketId: m.marketId,
      label: m.question,
      side,
      size,
      payoutUsdc: size,
      strikeMarket: m.marketId,
      collateralVault: m.collateralVault,
      winningMint: side === "yes" ? m.yesMint : m.noMint,
      treasury: m.treasury,
    });
  }
  return out;
}

export function buildPortfolio(
  markets: readonly MarketView[],
  states: ReadonlyMap<string, MarketAccountState>,
  usdc: number | null,
): Portfolio {
  const positions: PositionRow[] = [];
  const orders: OrderRow[] = [];
  const seats: SeatRow[] = [];
  for (const m of markets) {
    const s = states.get(m.marketId);
    if (!s) continue;
    const lot = m.lotSize ?? 1;
    const seat = s.phoenix?.seat;
    if (s.phoenix && seat && (seat.yesFree > 0 || seat.yesLocked > 0 || seat.usdcFree > 0 || seat.usdcLocked > 0)) {
      seats.push({ market: m, phoenixMarket: s.phoenix.phoenixMarket, ...seat });
    }
    for (const o of labelOrders(s)) orders.push({ ...o, market: m });
    if (m.status !== "open") continue;
    const { position } = availabilityInputs(s);
    const yes = position.yesQty >= lot ? position.yesQty : 0;
    const no = position.noQty >= lot ? position.noQty : 0;
    if (yes === 0 && no === 0) continue;
    const ym = yesMark(m);
    const side: PositionRow["side"] = yes > 0 && no > 0 ? "both" : yes > 0 ? "yes" : "no";
    const mark = side === "no" ? round6(1 - ym) : ym;
    const value = side === "both" ? yes * ym + no * (1 - ym) : (side === "yes" ? yes : no) * mark;
    positions.push({
      market: m,
      side,
      qty: side === "no" ? no : yes,
      yesQty: yes,
      noQty: no,
      inSeat: side === "no" ? 0 : seat?.yesFree ?? 0,
      mark,
      value: round6(value),
    });
  }
  const redeemable = redeemableRows(markets, states);
  return {
    positions,
    orders,
    seats,
    redeemable,
    totals: {
      usdc,
      seatUsdcFree: round6(seats.reduce((a, r) => a + r.usdcFree, 0)),
      redeemableUsdc: round6(redeemable.reduce((a, r) => a + r.payoutUsdc, 0)),
      positionsValue: round6(positions.reduce((a, r) => a + r.value, 0)),
    },
  };
}
