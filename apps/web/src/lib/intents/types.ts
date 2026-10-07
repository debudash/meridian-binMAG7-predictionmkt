/** Trading intents — docs/ui/06 §1 */
export type Intent = "buy-yes" | "sell-yes" | "buy-no" | "sell-no";

export type MarketLifecycleStatus =
  | "open"
  | "closing-soon"
  | "closed"
  | "resolving"
  | "delayed"
  | "settled"
  | "voided";

/** On-chain StrikeMarket.status (docs/SCHEMA.md) */
export const STRIKE_STATUS = {
  Open: 0,
  Settling: 1,
  SettledYes: 2,
  SettledNo: 3,
  Void: 4,
} as const;

export interface PositionSnapshot {
  /** Settled Yes contracts (wallet + Phoenix free) */
  yesQty: number;
  /** Settled No contracts */
  noQty: number;
  /** Locked in open sell asks (Yes) */
  yesLockedInAsks?: number;
  /** Locked in open sell orders (No) */
  noLockedInOrders?: number;
}

export interface OpenOrdersSnapshot {
  openBuyYesQty: number;
  openBuyNoQty: number;
  openSellYesQty?: number;
  openSellNoQty?: number;
}

export interface PendingTxSnapshot {
  /** In-flight trade txs for this market */
  pendingTradeCount: number;
}

export interface MarketStateSnapshot {
  /** UI lifecycle from countdown (§3); trading disabled unless open/closing-soon */
  lifecycle: MarketLifecycleStatus;
  /** Lot size for dust rule E4; default 1 */
  lotSize?: number;
}

export interface IntentAvailability {
  enabled: boolean;
  /** "nothing-to-sell" | "blocked" | "pending" | "market-closed" | … */
  reason?: string;
  /** User-facing copy under disabled intent (06 §2.3) */
  copy?: string;
  /** Optional CTA e.g. { label: "Sell 40 Yes", intent: "sell-yes", size: 40 } */
  cta?: { label: string; intent: Intent; size?: number };
}

export type IntentAvailabilityMap = Record<Intent, IntentAvailability>;
