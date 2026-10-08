/**
 * "What if" payoff line + distance to strike (DLV-075).
 * Pure copy/math — the ticket feeds it intent, size and the effective price
 * (live touch for Market, typed price for Limit), always in the intent's own terms
 * (Yes price for Yes intents, No price for No intents).
 *
 * Settle rule (D-005): Yes wins iff settlement price ≥ strike; No wins iff < strike.
 * Amounts are before fees (fees default 0 bps, D-006).
 */
import type { Intent } from "@/lib/intents/types";

export interface WhatIfInput {
  intent: Intent;
  /** Contracts */
  size: number;
  /** Price per contract in the intent's terms, 0 < p < 1 */
  price: number;
  symbol: string;
  strike: number;
  /** Short expiry label, e.g. "Oct 14" */
  whenShort: string;
}

export interface WhatIfResult {
  /** Full plain sentence for the ticket */
  sentence: string;
  /** USDC paid (buys) or received now (sells) */
  cashNow: number;
  /** USDC paid out at settle if the intent's side wins (buys) / given up (sells) */
  payoutIfWin: number;
  /** Buys: profit if right (payout − cost). Sells: payout forgone net of proceeds. */
  net: number;
  /** Which close condition pays the intent's side */
  winCondition: string;
}

export function usd(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return `$${Math.abs(v).toFixed(2)}`;
}

export function signedUsd(n: number): string {
  if (Math.abs(n) < 0.005) return "$0.00";
  return `${n > 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
}

function fmtStrike(strike: number): string {
  return `$${strike.toFixed(2)}`;
}

/** Close condition that makes the side pay: Yes ≥ strike, No < strike (D-005). */
export function winConditionFor(side: "yes" | "no", symbol: string, strike: number, whenShort: string): string {
  return side === "yes"
    ? `${symbol} closes ≥ ${fmtStrike(strike)} on ${whenShort}`
    : `${symbol} closes below ${fmtStrike(strike)} on ${whenShort}`;
}

export function whatIfPayoff(input: WhatIfInput): WhatIfResult | null {
  const { intent, size, price, symbol, strike, whenShort } = input;
  if (!Number.isFinite(size) || size <= 0) return null;
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const side: "yes" | "no" = intent.endsWith("yes") ? "yes" : "no";
  const cond = winConditionFor(side, symbol, strike, whenShort);
  const payout = size * 1;
  const cash = size * price;

  if (intent.startsWith("buy")) {
    const profit = payout - cash;
    return {
      sentence: `If ${cond} you get ${usd(payout)} (${signedUsd(profit)}). If not, you lose ${usd(cash)}.`,
      cashNow: cash,
      payoutIfWin: payout,
      net: profit,
      winCondition: cond,
    };
  }

  // Sells: cash now, and you give up the payout your contracts would have earned.
  return {
    sentence: `You get ${usd(cash)} now. If ${cond} you give up ${usd(payout)} (${signedUsd(cash - payout)} vs holding). If not, they would have paid $0.00.`,
    cashNow: cash,
    payoutIfWin: payout,
    net: cash - payout,
    winCondition: cond,
  };
}

export interface DistanceToStrike {
  /** e.g. "NVDA $138.20" */
  priceLabel: string;
  /** e.g. "needs +1.3%" / "1.3% above strike" / "at strike" */
  distanceLabel: string;
  /** Signed % move from current price needed to reach the strike (+ = up). */
  movePct: number;
  /** Side that would win if it settled at this price right now (D-005). */
  leading: "yes" | "no";
}

function pct(n: number): string {
  const a = Math.abs(n);
  return a < 0.05 ? a.toFixed(2) : a.toFixed(1);
}

/**
 * Live distance readout. Yes needs price ≥ strike, so:
 * - below strike → "needs +x%" (move up required for Yes)
 * - at/above strike → "is x% above strike" / "at strike (Yes if ≥)" (≥ counts as Yes, D-005)
 */
export function distanceToStrike(
  symbol: string,
  price: number | null | undefined,
  strike: number,
): DistanceToStrike | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const movePct = ((strike - price) / price) * 100;
  const priceLabel = `${symbol} $${price.toFixed(2)}`;
  if (price >= strike) {
    const abovePct = ((price - strike) / strike) * 100;
    return {
      priceLabel,
      distanceLabel: abovePct < 0.005 ? "at strike (Yes if ≥)" : `is ${pct(abovePct)}% above strike`,
      movePct,
      leading: "yes",
    };
  }
  return {
    priceLabel,
    distanceLabel: `needs +${pct(movePct)}%`,
    movePct,
    leading: "no",
  };
}
