/**
 * Phoenix placement types — D-015 Yes/USDC book (docs/ui/06).
 */
import type { Intent } from "@/lib/intents/types";

export type PhoenixOrderType = "market" | "limit" | "post-only";

export interface PhoenixPlaceOrderRequest {
  phoenixMarket: string;
  intent: Intent;
  /** Price in intent-side terms (Yes or No) */
  price: number;
  size: number;
  orderType: PhoenixOrderType;
  /** Slippage cap for market (side terms) */
  worstPrice?: number;
  tickSize?: number;
  /** Meridian strike market pubkey (required for Buy No mint leg) */
  strikeMarket?: string;
  yesMint?: string;
  noMint?: string;
  collateralVault?: string;
  treasury?: string;
  collateralMint?: string;
}

export type PlaceFailureReason =
  | "not-configured"
  | "wallet-required"
  | "seat-required"
  | "mint-accounts-missing"
  | "merge-schema-todo"
  | "sdk-error"
  | "user-rejected";

export interface MappedBookAction {
  side: "bid" | "ask";
  yesPrice: number;
  size: number;
}

export interface PhoenixPlaceOrderResult {
  ok: boolean;
  stub?: boolean;
  reason?: PlaceFailureReason;
  message: string;
  mapped: MappedBookAction;
  /** Planned legs for UI status */
  plan?: ComposePlanSummary;
  signature?: string;
  signatures?: string[];
}

export interface ComposePlanSummary {
  intent: Intent;
  phoenixSide: "bid" | "ask";
  yesPrice: number;
  size: number;
  orderType: PhoenixOrderType;
  /** Meridian mint Yes+No for qty before Phoenix ask */
  needsMint: boolean;
  /** Schema TODO: merge Yes+No → USDC after Buy Yes fill (Sell No) */
  needsMerge: boolean;
  mergeBlocked: boolean;
  notes: string[];
  /** Preferred packaging: multi-ix single tx when mint+place */
  packaging: "phoenix-only" | "mint-then-phoenix" | "phoenix-then-merge-todo";
}
