/**
 * Intent → Yes/USDC book composition planner (test harness twin of
 * apps/web/src/lib/phoenix/compose.ts). Kept dependency-free for mocha.
 *
 * Buy No: mint then ask Yes @ 1−p_no.
 * Sell No market: bid Yes @ 1−p_no then merge_pair.
 * Sell No resting: bid only; merge-on-fill still phased.
 */
export type PhoenixIntent = "buy-yes" | "sell-yes" | "buy-no" | "sell-no";
export type PhoenixOrderType = "market" | "limit" | "post-only";

export interface ComposePlan {
  intent: PhoenixIntent;
  phoenixSide: "bid" | "ask";
  yesPrice: number;
  sizeContracts: number;
  orderType: PhoenixOrderType;
  needsMint: boolean;
  needsMerge: boolean;
  mergeBlocked: boolean;
  packaging:
    | "phoenix-only"
    | "mint-then-phoenix"
    | "phoenix-then-merge"
    | "phoenix-then-merge-todo";
  notes: string[];
}

const DEFAULT_TICK = 0.01;

export function toTicks(price: number, tickSize = DEFAULT_TICK): number {
  return Math.round(price / tickSize);
}

export function fromTicks(ticks: number, tickSize = DEFAULT_TICK): number {
  return ticks * tickSize;
}

export function snapYesPrice(yesPrice: number, tickSize = DEFAULT_TICK): number {
  return fromTicks(toTicks(yesPrice, tickSize), tickSize);
}

export function isImmediateFillOrder(orderType: PhoenixOrderType): boolean {
  return orderType === "market";
}

function priceFromUser(intent: PhoenixIntent, sidePrice: number): number {
  switch (intent) {
    case "buy-yes":
    case "sell-yes":
      return sidePrice;
    case "buy-no":
    case "sell-no":
      return 1 - sidePrice;
    default:
      return sidePrice;
  }
}

export function planIntentComposition(input: {
  intent: PhoenixIntent;
  price: number;
  size: number;
  orderType: PhoenixOrderType;
  tickSize?: number;
}): ComposePlan {
  const tick = input.tickSize ?? DEFAULT_TICK;
  const yesPrice = snapYesPrice(priceFromUser(input.intent, input.price), tick);
  const notes: string[] = [];

  switch (input.intent) {
    case "buy-yes":
      notes.push("Phoenix bid Yes/USDC (on-book).");
      return {
        intent: input.intent,
        phoenixSide: "bid",
        yesPrice,
        sizeContracts: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: false,
        mergeBlocked: false,
        packaging: "phoenix-only",
        notes,
      };
    case "sell-yes":
      notes.push("Phoenix ask Yes/USDC (on-book).");
      return {
        intent: input.intent,
        phoenixSide: "ask",
        yesPrice,
        sizeContracts: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: false,
        mergeBlocked: false,
        packaging: "phoenix-only",
        notes,
      };
    case "buy-no":
      notes.push("Mint Yes+No, then ask Yes at 1−p_no (on-book).");
      return {
        intent: input.intent,
        phoenixSide: "ask",
        yesPrice,
        sizeContracts: input.size,
        orderType: input.orderType,
        needsMint: true,
        needsMerge: false,
        mergeBlocked: false,
        packaging: "mint-then-phoenix",
        notes,
      };
    case "sell-no": {
      notes.push("Bid Yes at 1−p_no (economic sell of No).");
      if (isImmediateFillOrder(input.orderType)) {
        notes.push("Immediate: merge_pair after bid fill (phoenix-then-merge).");
        return {
          intent: input.intent,
          phoenixSide: "bid",
          yesPrice,
          sizeContracts: input.size,
          orderType: input.orderType,
          needsMint: false,
          needsMerge: true,
          mergeBlocked: false,
          packaging: "phoenix-then-merge",
          notes,
        };
      }
      notes.push(
        "Resting limit/post-only: bid only; merge-on-fill still phased (not automatic).",
      );
      return {
        intent: input.intent,
        phoenixSide: "bid",
        yesPrice,
        sizeContracts: input.size,
        orderType: input.orderType,
        needsMint: false,
        needsMerge: true,
        mergeBlocked: true,
        packaging: "phoenix-then-merge-todo",
        notes,
      };
    }
    default:
      throw new Error(`unknown intent ${(input as { intent: string }).intent}`);
  }
}

/** Quote USDC raw atoms for a Yes base fill at yesPrice ∈ (0,1]. Same decimals assumed. */
export function quoteAtomsForYesFill(baseAtoms: bigint, yesPrice: number): bigint {
  if (yesPrice <= 0 || yesPrice > 1) {
    throw new Error(`yesPrice out of range: ${yesPrice}`);
  }
  // price e6: 0.60 → 600_000
  const priceE6 = BigInt(Math.round(yesPrice * 1_000_000));
  return (baseAtoms * priceE6) / 1_000_000n;
}

export const DEFAULT_OUTCOME_DECIMALS = 6;

export function contractsToRaw(contracts: number, decimals = DEFAULT_OUTCOME_DECIMALS): bigint {
  return BigInt(Math.round(contracts * 10 ** decimals));
}
