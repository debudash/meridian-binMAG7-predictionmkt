import type { MarketLifecycleStatus } from "@/lib/intents/types";

/** UI market view-model. Maps Schema StrikeMarket + indexer fields. */
export interface MarketView {
  marketId: string;
  /** Human question */
  question: string;
  underlyingSymbol: string;
  /** Strike in USDC (human), e.g. 230 */
  strike: number;
  /** Default Schema comparator: ≥ */
  comparator: ">=" | ">";
  /** Unix seconds — Schema `expiry_ts` (mint window / observation) */
  tradingCloseTs: number;
  /** Unix seconds — expected settle observation (often same as expiry) */
  settleTs: number;
  /** Schema status u8 mapped */
  status: "open" | "settling" | "settled-yes" | "settled-no" | "void";
  outcome?: "yes" | "no" | "void";
  resolvedPrice?: number;
  resolvedAt?: number;
  /** Pyth price ACCOUNT pubkey (`StrikeMarket.pyth_price_feed`) — name kept for compat */
  pythFeedId?: string;
  /** 32-byte Pyth feed id hex (`StrikeMarket.pyth_feed_id`); undefined if all-zero */
  pythFeedIdHex?: string;
  /** `StrikeMarket.settled_slot` (effective clock slot at settle) */
  settledSlot?: number;
  phoenixMarket?: string;
  yesMint?: string;
  noMint?: string;
  /** Meridian collateral vault (mint/redeem) */
  collateralVault?: string;
  /** Fee treasury ATA */
  treasury?: string;
  /** Top of book Yes mid / last (0–1) */
  yesMid?: number;
  yesBid?: number;
  yesAsk?: number;
  lastYes?: number;
  volume24hUsdc?: number;
  openInterest?: number;
  tickSize: number;
  lotSize: number;
  minPrice: number;
  maxPrice: number;
  underlyingPrice?: number;
  underlyingPublishTs?: number;
}

export interface BookLevel {
  /** Price in Yes terms (0–1), tick-aligned */
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  bids: BookLevel[]; // Yes bids, best first
  asks: BookLevel[]; // Yes asks, best first
  sequence?: number;
  updatedAt?: number;
}

export type { MarketLifecycleStatus };
