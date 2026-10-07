/**
 * Order-book row selection ⇄ order-ticket price sync (DLV-071).
 *
 * All keys are integer ticks of the **Yes** price, so a selection survives the
 * 4s book refresh (matched by price, never by row index) and maps cleanly
 * between the Yes and No perspectives (p_no = 1 − p_yes).
 */
import type { Intent } from "@/lib/intents/types";
import type { OrderBookSnapshot } from "./types";
import type { Perspective } from "./bookTransform";

const EPS = 1e-6;

/** Integer tick key for a Yes price, or null when the price is off-grid / invalid. */
export function yesKey(yesPrice: number, tickSize: number): number | null {
  if (!Number.isFinite(yesPrice) || !(tickSize > 0)) return null;
  const raw = yesPrice / tickSize;
  const k = Math.round(raw);
  return Math.abs(raw - k) < EPS ? k : null;
}

/** Yes-terms price for a price quoted in `terms` (Yes or No). */
export function toYesPrice(price: number, terms: Perspective): number {
  return terms === "no" ? 1 - price : price;
}

/** Round to the tick grid without float noise (57 × 0.01 → 0.57, not 0.5700000000000001). */
export function roundToTick(price: number, tickSize: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(tickSize) - EPS));
  return Number((Math.round(price / tickSize) * tickSize).toFixed(decimals));
}

/** Price in `terms` for a Yes-terms price, rounded to the tick grid. */
export function fromYesPrice(yesPrice: number, terms: Perspective, tickSize: number): number {
  return roundToTick(terms === "no" ? 1 - yesPrice : yesPrice, tickSize);
}

export function intentTerms(intent: Intent): Perspective {
  return intent.endsWith("-no") ? "no" : "yes";
}

/** Yes tick key of a book row shown in `perspective` terms. */
export function rowKey(displayPrice: number, perspective: Perspective, tickSize: number): number | null {
  return yesKey(toYesPrice(displayPrice, perspective), tickSize);
}

/** Yes tick keys of every level on the raw (Yes-terms) book. */
export function bookKeys(book: OrderBookSnapshot, tickSize: number): Set<number> {
  const s = new Set<number>();
  for (const l of [...book.bids, ...book.asks]) {
    const k = yesKey(l.price, tickSize);
    if (k != null) s.add(k);
  }
  return s;
}

export interface TicketPriceState {
  intent: Intent;
  price: number;
  orderType: "market" | "limit";
}

/**
 * Yes tick key the ticket is pointing at. Only limit orders sync to a level —
 * market orders follow the touch and don't represent a chosen level.
 */
export function ticketKey(t: TicketPriceState | null, tickSize: number): number | null {
  if (!t || t.orderType !== "limit") return null;
  return yesKey(toYesPrice(t.price, intentTerms(t.intent)), tickSize);
}

export interface BookSelectionState {
  /** Explicitly clicked level (Yes tick key). */
  selectedKey: number | null;
  /** Level the user toggled off while the ticket still points at it. */
  suppressedKey: number | null;
}

export const initialBookSelection: BookSelectionState = {
  selectedKey: null,
  suppressedKey: null,
};

export type BookSelectionAction =
  /** Row click; `highlightedKey` is what is currently highlighted (for toggle-off). */
  | { type: "click"; key: number; highlightedKey: number | null }
  /** Ticket intent/price/orderType changed — `key` from {@link ticketKey}. */
  | { type: "ticket"; key: number | null }
  /** Book refreshed — `keys` from {@link bookKeys}. */
  | { type: "book"; keys: Set<number> };

export function bookSelectionReducer(
  state: BookSelectionState,
  action: BookSelectionAction,
): BookSelectionState {
  switch (action.type) {
    case "click":
      if (action.highlightedKey === action.key) {
        // Same row again → deselect, and keep the ticket-sync highlight off
        // until the ticket price moves.
        return { selectedKey: null, suppressedKey: action.key };
      }
      return { selectedKey: action.key, suppressedKey: null };
    case "ticket": {
      const selectedKey =
        state.selectedKey != null && action.key !== state.selectedKey ? null : state.selectedKey;
      const suppressedKey =
        state.suppressedKey != null && action.key !== state.suppressedKey
          ? null
          : state.suppressedKey;
      if (selectedKey === state.selectedKey && suppressedKey === state.suppressedKey) return state;
      return { selectedKey, suppressedKey };
    }
    case "book":
      if (state.selectedKey != null && !action.keys.has(state.selectedKey)) {
        return { ...state, selectedKey: null };
      }
      return state;
  }
}

/** Which level (Yes tick key) the book should highlight, or null. */
export function resolveHighlightKey(
  state: BookSelectionState,
  tKey: number | null,
  keys: Set<number>,
): number | null {
  if (state.selectedKey != null && keys.has(state.selectedKey)) return state.selectedKey;
  if (tKey != null && keys.has(tKey) && tKey !== state.suppressedKey) return tKey;
  return null;
}

/**
 * Price to put in the ticket for a clicked row: the row is shown in
 * `perspective` terms, the ticket quotes in the target intent's terms.
 */
export function ticketPriceForRow(
  displayPrice: number,
  perspective: Perspective,
  targetIntent: Intent,
  tickSize: number,
): number {
  return fromYesPrice(toYesPrice(displayPrice, perspective), intentTerms(targetIntent), tickSize);
}
