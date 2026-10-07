/**
 * Dual perspective on one Yes/USDC Phoenix book — docs/ui/03 §4, 06 §1.2
 * Prices stored as integer ticks; format only at render.
 */
import type { BookLevel, OrderBookSnapshot } from "./types";

export type Perspective = "yes" | "no";

const DEFAULT_TICK = 0.01;

export function toTicks(price: number, tickSize = DEFAULT_TICK): number {
  return Math.round(price / tickSize);
}

export function fromTicks(ticks: number, tickSize = DEFAULT_TICK): number {
  return ticks * tickSize;
}

/** Transform a Yes-book snapshot into the display perspective. */
export function transformBook(
  book: OrderBookSnapshot,
  perspective: Perspective,
  tickSize = DEFAULT_TICK,
): OrderBookSnapshot {
  if (perspective === "yes") {
    return {
      bids: [...book.bids].sort((a, b) => b.price - a.price),
      asks: [...book.asks].sort((a, b) => a.price - b.price),
      sequence: book.sequence,
      updatedAt: book.updatedAt,
    };
  }

  // No: p_no = 1 - p_yes; bids↔asks swapped
  const invert = (levels: BookLevel[]): BookLevel[] =>
    levels.map((l) => ({
      price: fromTicks(toTicks(1 - l.price, tickSize), tickSize),
      size: l.size,
    }));

  return {
    // No bids = Yes asks transformed
    bids: invert(book.asks).sort((a, b) => b.price - a.price),
    // No asks = Yes bids transformed
    asks: invert(book.bids).sort((a, b) => a.price - b.price),
    sequence: book.sequence,
    updatedAt: book.updatedAt,
  };
}

export function midPrice(book: OrderBookSnapshot): number | undefined {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid == null || ask == null) return undefined;
  return (bid + ask) / 2;
}

export function noPriceFromYes(yesPrice: number, tickSize = DEFAULT_TICK): number {
  return fromTicks(toTicks(1 - yesPrice, tickSize), tickSize);
}

/**
 * Intent → Phoenix Yes-book action (06 §1).
 * Buy No / Sell No are economic transforms; actual ix TBD (TODO(schema/phoenix)).
 */
export function intentToBookAction(intent: string): {
  side: "bid" | "ask";
  priceFromUser: (pSide: number) => number;
} {
  switch (intent) {
    case "buy-yes":
      return { side: "bid", priceFromUser: (p) => p };
    case "sell-yes":
      return { side: "ask", priceFromUser: (p) => p };
    case "buy-no":
      // Economically Ask Yes at 1 - p_no
      return { side: "ask", priceFromUser: (pNo) => 1 - pNo };
    case "sell-no":
      // Economically Bid Yes at 1 - p_no
      return { side: "bid", priceFromUser: (pNo) => 1 - pNo };
    default:
      return { side: "bid", priceFromUser: (p) => p };
  }
}
