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
  /** Ticket lot size in contracts (MarketView.lotSize); sizes must be whole multiples (M1) */
  lotSize?: number;
  orderType: PhoenixOrderType;
  /** Slippage cap for market (side terms) */
  worstPrice?: number;
  tickSize?: number;
  /** Meridian strike market pubkey (required for Buy No mint / Sell No merge) */
  strikeMarket?: string;
  yesMint?: string;
  noMint?: string;
  collateralVault?: string;
  treasury?: string;
  collateralMint?: string;
}

export type PlaceFailureReason =
  | "not-configured"
  | "invalid-size"
  | "wallet-required"
  | "seat-required"
  | "mint-accounts-missing"
  | "merge-accounts-missing"
  | "merge-schema-todo"
  | "sdk-error"
  | "no-fill"
  | "program-error"
  /** Phoenix book Paused (at expiry, !73): new orders refused; cancel / withdraw still work */
  | "market-paused"
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
  /** L11: the tx also withdrew free seat funds (WithdrawFunds(all)) to the wallet */
  swept?: boolean;
  /** Blockhash the tx was built with — for blockhash-expiry confirmation (L14) */
  blockhash?: { blockhash: string; lastValidBlockHeight: number };
}

export interface ComposePlanSummary {
  intent: Intent;
  phoenixSide: "bid" | "ask";
  yesPrice: number;
  size: number;
  orderType: PhoenixOrderType;
  /** Meridian mint Yes+No for qty before Phoenix ask */
  needsMint: boolean;
  /** Meridian merge_pair after Phoenix bid (Sell No) */
  needsMerge: boolean;
  /**
   * true = resting path: bid only; merge-on-fill still phased.
   * false on immediate (market) Sell No: merge_pair packed in same tx.
   */
  mergeBlocked: boolean;
  notes: string[];
  /** Preferred packaging: multi-ix single tx when mint/place/merge */
  packaging:
    | "phoenix-only"
    | "mint-then-phoenix"
    | "phoenix-then-merge"
    | "phoenix-then-merge-todo";
}
