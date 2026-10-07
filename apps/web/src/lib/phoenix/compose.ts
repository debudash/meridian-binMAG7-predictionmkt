/**
 * Intent → Yes/USDC book composition planner (pure).
 * docs/ui/06 §1 — no matching engine; client-side packing only.
 *
 * Buy No: mint q via Meridian, then Phoenix ask Yes at 1−p_no.
 * Transient Yes+No inside the (multi-ix) tx is OK per 06 §1.
 * Sell No: bid Yes at 1−p_no; immediate (market) → merge_pair same tx;
 * resting (limit/post-only) → bid only, merge-on-fill still phased.
 */
import type { Intent } from "@/lib/intents/types";
import { intentToBookAction, noPriceFromYes, toTicks, fromTicks } from "@/lib/market/bookTransform";
import type { ComposePlanSummary, PhoenixOrderType } from "./types";
import { SELL_NO_MERGE_CAVEAT } from "./config";

export interface ComposeInput {
  intent: Intent;
  /** User-facing price (Yes terms for Yes intents; No terms for No intents) */
  price: number;
  size: number;
  orderType: PhoenixOrderType;
  tickSize?: number;
  worstPrice?: number;
}

/** Snap yes-book price to tick grid. */
export function snapYesPrice(yesPrice: number, tickSize = 0.01): number {
  return fromTicks(toTicks(yesPrice, tickSize), tickSize);
}

/** Market / IOC-style orders attempt immediate fill → pack merge_pair. */
export function isImmediateFillOrder(orderType: PhoenixOrderType): boolean {
  return orderType === "market";
}

/**
 * Plan the legs for an intent without building Solana instructions.
 * Safe to unit-test offline.
 */
export function planIntentComposition(input: ComposeInput): ComposePlanSummary {
  const tick = input.tickSize ?? 0.01;
  const action = intentToBookAction(input.intent);
  const rawYes = action.priceFromUser(input.price);
  const yesPrice = snapYesPrice(rawYes, tick);
  const notes: string[] = [];

  switch (input.intent) {
    case "buy-yes":
      notes.push("Phoenix bid Yes/USDC.");
      return {
        intent: input.intent,
        phoenixSide: "bid",
        yesPrice,
        size: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: false,
        mergeBlocked: false,
        notes,
        packaging: "phoenix-only",
      };
    case "sell-yes":
      notes.push("Phoenix ask Yes/USDC.");
      return {
        intent: input.intent,
        phoenixSide: "ask",
        yesPrice,
        size: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: false,
        mergeBlocked: false,
        notes,
        packaging: "phoenix-only",
      };
    case "buy-no": {
      notes.push(
        "Mint Yes+No pair via Meridian mint, then Phoenix ask Yes at 1−p_no.",
      );
      notes.push(
        "Transient Yes+No co-holding inside the tx is allowed (06 §1); user ends long No.",
      );
      return {
        intent: input.intent,
        phoenixSide: "ask",
        yesPrice,
        size: input.size,
        orderType: input.orderType,
        needsMint: true,
        needsMerge: false,
        mergeBlocked: false,
        notes,
        packaging: "mint-then-phoenix",
      };
    }
    case "sell-no": {
      notes.push("Phoenix bid Yes at 1−p_no (economic sell of No).");
      if (isImmediateFillOrder(input.orderType)) {
        notes.push(
          "Immediate path: append Meridian merge_pair after Phoenix place (phoenix-then-merge).",
        );
        return {
          intent: input.intent,
          phoenixSide: "bid",
          yesPrice,
          size: input.size,
          orderType: input.orderType,
          needsMint: false,
          needsMerge: true,
          mergeBlocked: false,
          notes,
          packaging: "phoenix-then-merge",
        };
      }
      notes.push(SELL_NO_MERGE_CAVEAT);
      return {
        intent: input.intent,
        phoenixSide: "bid",
        yesPrice,
        size: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: true,
        mergeBlocked: true,
        notes,
        packaging: "phoenix-then-merge-todo",
      };
    }
    default:
      return {
        intent: input.intent,
        phoenixSide: "bid",
        yesPrice,
        size: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: false,
        mergeBlocked: false,
        notes: ["Unknown intent — defaulted to bid."],
        packaging: "phoenix-only",
      };
  }
}

/** Inverse: display No price from planned Yes book price. */
export function displayNoPrice(yesPrice: number, tickSize = 0.01): number {
  return noPriceFromYes(yesPrice, tickSize);
}

/**
 * Limit/IOC/post-only price for the Yes book.
 * Market orders use worstPrice when provided; else raw yesPrice.
 */
export function effectiveYesLimitPrice(
  plan: ComposePlanSummary,
  worstPriceSide?: number,
  tickSize = 0.01,
): number {
  if (plan.orderType !== "market" || worstPriceSide == null) {
    return plan.yesPrice;
  }
  const action = intentToBookAction(plan.intent);
  return snapYesPrice(action.priceFromUser(worstPriceSide), tickSize);
}
