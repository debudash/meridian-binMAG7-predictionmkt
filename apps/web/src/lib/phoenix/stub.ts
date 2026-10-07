/**
 * Phoenix CLOB integration stub — D-015 Yes/USDC book.
 * Full SDK order placement deferred; UI shows book shell + intent mapping.
 * TODO(phoenix): seat/claim, placeLimit, IOC, cancel, settleFunds.
 */
import type { Intent } from "@/lib/intents/types";
import { intentToBookAction } from "@/lib/market/bookTransform";
import type { OrderBookSnapshot } from "@/lib/market/types";

export interface PhoenixPlaceOrderRequest {
  phoenixMarket: string;
  intent: Intent;
  /** Price in intent-side terms (Yes or No) */
  price: number;
  size: number;
  orderType: "market" | "limit" | "post-only";
  /** Slippage cap for market (USDC) */
  worstPrice?: number;
}

export interface PhoenixPlaceOrderResult {
  ok: false;
  stub: true;
  message: string;
  mapped: {
    side: "bid" | "ask";
    yesPrice: number;
    size: number;
  };
}

/** Stub: maps intent → Yes-book action; does not submit to Phoenix. */
export async function placePhoenixOrder(
  req: PhoenixPlaceOrderRequest,
): Promise<PhoenixPlaceOrderResult> {
  const action = intentToBookAction(req.intent);
  const yesPrice = action.priceFromUser(req.price);
  return {
    ok: false,
    stub: true,
    message:
      "TODO(phoenix): Phoenix SDK order placement not wired. Intent mapped to Yes/USDC book action only.",
    mapped: {
      side: action.side,
      yesPrice,
      size: req.size,
    },
  };
}

export async function fetchPhoenixBook(
  _phoenixMarket: string | undefined,
): Promise<OrderBookSnapshot | null> {
  // TODO(phoenix): subscribe to Phoenix market account
  return null;
}

export const PHOENIX_STUB_NOTICE =
  "Order book is a UI shell. Phoenix placement is stubbed (TODO(phoenix)).";
