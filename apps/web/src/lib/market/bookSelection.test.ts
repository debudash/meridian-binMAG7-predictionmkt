import { describe, expect, it } from "vitest";
import {
  bookKeys,
  bookSelectionReducer,
  fromYesPrice,
  initialBookSelection,
  resolveHighlightKey,
  roundToTick,
  rowKey,
  ticketKey,
  ticketPriceForRow,
  yesKey,
  type BookSelectionState,
} from "./bookSelection";
import { transformBook } from "./bookTransform";
import type { OrderBookSnapshot } from "./types";

const TICK = 0.01;

const book = (bids: number[], asks: number[]): OrderBookSnapshot => ({
  bids: bids.map((price) => ({ price, size: 100 })),
  asks: asks.map((price) => ({ price, size: 100 })),
});

// Same shape as the localnet ladder Debu screenshotted.
const LADDER = book([0.49, 0.47, 0.45, 0.43, 0.41], [0.51, 0.53, 0.55]);
const KEYS = bookKeys(LADDER, TICK);

describe("price keys", () => {
  it("keys Yes prices by integer tick, tolerant of float noise", () => {
    expect(yesKey(0.47, TICK)).toBe(47);
    expect(yesKey(1 - 0.53, TICK)).toBe(47);
    expect(yesKey(0.57, TICK)).toBe(57);
  });

  it("rejects off-grid or invalid prices", () => {
    expect(yesKey(0.475, TICK)).toBeNull();
    expect(yesKey(Number.NaN, TICK)).toBeNull();
    expect(yesKey(0.5, 0)).toBeNull();
  });

  it("rounds to tick without float noise", () => {
    expect(roundToTick(57 * 0.01, TICK)).toBe(0.57);
    expect(fromYesPrice(0.43, "no", TICK)).toBe(0.57);
    expect(fromYesPrice(0.43, "yes", TICK)).toBe(0.43);
  });

  it("maps No-perspective rows back to the same Yes level", () => {
    const noView = transformBook(LADDER, "no", TICK);
    const yesFromNoRows = [...noView.bids, ...noView.asks]
      .map((l) => rowKey(l.price, "no", TICK))
      .sort();
    expect(new Set(yesFromNoRows)).toEqual(KEYS);
    // Yes ask 0.51 shows as No bid 0.49 → same key
    expect(rowKey(0.49, "no", TICK)).toBe(rowKey(0.51, "yes", TICK));
  });
});

describe("ticketKey (ticket → book)", () => {
  it("is null for market orders (they follow the touch, not a chosen level)", () => {
    expect(ticketKey({ intent: "buy-yes", price: 0.51, orderType: "market" }, TICK)).toBeNull();
    expect(ticketKey(null, TICK)).toBeNull();
  });

  it("uses the price directly for Yes intents", () => {
    expect(ticketKey({ intent: "buy-yes", price: 0.47, orderType: "limit" }, TICK)).toBe(47);
    expect(ticketKey({ intent: "sell-yes", price: 0.53, orderType: "limit" }, TICK)).toBe(53);
  });

  it("maps No-intent prices through 1 − p", () => {
    expect(ticketKey({ intent: "buy-no", price: 0.53, orderType: "limit" }, TICK)).toBe(47);
    expect(ticketKey({ intent: "sell-no", price: 0.49, orderType: "limit" }, TICK)).toBe(51);
  });
});

describe("ticketPriceForRow (book → ticket)", () => {
  it("passes Yes rows straight to Yes intents", () => {
    expect(ticketPriceForRow(0.47, "yes", "sell-yes", TICK)).toBe(0.47);
  });
  it("converts Yes rows to No terms for No intents", () => {
    expect(ticketPriceForRow(0.47, "yes", "buy-no", TICK)).toBe(0.53);
  });
  it("converts No rows to Yes terms for Yes intents (blocked hint fallback)", () => {
    expect(ticketPriceForRow(0.53, "no", "buy-yes", TICK)).toBe(0.47);
  });
  it("keeps No rows in No terms for No intents", () => {
    expect(ticketPriceForRow(0.53, "no", "buy-no", TICK)).toBe(0.53);
  });
  it("round-trips: row → ticket price → ticketKey hits the same level", () => {
    for (const persp of ["yes", "no"] as const) {
      for (const intent of ["buy-yes", "sell-yes", "buy-no", "sell-no"] as const) {
        const view = transformBook(LADDER, persp, TICK);
        for (const l of [...view.bids, ...view.asks]) {
          const price = ticketPriceForRow(l.price, persp, intent, TICK);
          expect(ticketKey({ intent, price, orderType: "limit" }, TICK)).toBe(
            rowKey(l.price, persp, TICK),
          );
        }
      }
    }
  });
});

describe("bookSelectionReducer + resolveHighlightKey", () => {
  const click = (s: BookSelectionState, key: number, tKey: number | null, keys = KEYS) =>
    bookSelectionReducer(s, {
      type: "click",
      key,
      highlightedKey: resolveHighlightKey(s, tKey, keys),
    });

  it("clicking a row selects it", () => {
    const s = click(initialBookSelection, 47, null);
    expect(s.selectedKey).toBe(47);
    expect(resolveHighlightKey(s, null, KEYS)).toBe(47);
  });

  it("survives a book refresh that reorders/resizes levels (matched by price)", () => {
    let s = click(initialBookSelection, 47, null);
    const refreshed = book([0.5, 0.49, 0.47, 0.41], [0.52, 0.53]); // new top, 0.47 moved row
    s = bookSelectionReducer(s, { type: "book", keys: bookKeys(refreshed, TICK) });
    expect(resolveHighlightKey(s, 47, bookKeys(refreshed, TICK))).toBe(47);
  });

  it("clears when the level disappears from the book", () => {
    let s = click(initialBookSelection, 47, 47);
    const gone = bookKeys(book([0.49, 0.45], [0.51]), TICK);
    s = bookSelectionReducer(s, { type: "book", keys: gone });
    expect(s.selectedKey).toBeNull();
    // ticket still says 0.47 but the level is gone → nothing highlighted
    expect(resolveHighlightKey(s, 47, gone)).toBeNull();
  });

  it("clears when the user types a different ticket price", () => {
    let s = click(initialBookSelection, 47, null);
    s = bookSelectionReducer(s, { type: "ticket", key: 47 }); // ticket applied the click
    expect(s.selectedKey).toBe(47);
    s = bookSelectionReducer(s, { type: "ticket", key: 46 }); // typed 0.46 (no level)
    expect(s.selectedKey).toBeNull();
    expect(resolveHighlightKey(s, 46, KEYS)).toBeNull();
  });

  it("clears when the ticket switches to market", () => {
    let s = click(initialBookSelection, 51, 51);
    s = bookSelectionReducer(s, { type: "ticket", key: null });
    expect(resolveHighlightKey(s, null, KEYS)).toBeNull();
  });

  it("typing a price that matches another level moves the highlight there", () => {
    let s = click(initialBookSelection, 47, 47);
    s = bookSelectionReducer(s, { type: "ticket", key: 43 });
    expect(resolveHighlightKey(s, 43, KEYS)).toBe(43);
  });

  it("clicking the same row again deselects, even though the ticket still matches", () => {
    let s = click(initialBookSelection, 47, null);
    s = bookSelectionReducer(s, { type: "ticket", key: 47 });
    s = click(s, 47, 47);
    expect(s.selectedKey).toBeNull();
    expect(resolveHighlightKey(s, 47, KEYS)).toBeNull();
    // ...until the ticket price moves away and back
    s = bookSelectionReducer(s, { type: "ticket", key: 45 });
    s = bookSelectionReducer(s, { type: "ticket", key: 47 });
    expect(resolveHighlightKey(s, 47, KEYS)).toBe(47);
  });

  it("clicking a ticket-synced (not clicked) row also toggles it off", () => {
    const s = click(initialBookSelection, 53, 53);
    expect(resolveHighlightKey(s, 53, KEYS)).toBeNull();
  });

  it("clicking a different row switches selection", () => {
    let s = click(initialBookSelection, 47, null);
    s = click(s, 53, 47);
    expect(resolveHighlightKey(s, 47, KEYS)).toBe(53);
  });

  it("ticket price alone highlights a matching level (ticket → book sync)", () => {
    expect(resolveHighlightKey(initialBookSelection, 45, KEYS)).toBe(45);
    expect(resolveHighlightKey(initialBookSelection, 46, KEYS)).toBeNull();
    // Buy No @ 0.55 ⇒ Yes 0.45 level
    const tk = ticketKey({ intent: "buy-no", price: 0.55, orderType: "limit" }, TICK);
    expect(resolveHighlightKey(initialBookSelection, tk, KEYS)).toBe(45);
  });

  it("returns the same state object for no-op ticket/book updates", () => {
    const s = click(initialBookSelection, 47, null);
    expect(bookSelectionReducer(s, { type: "ticket", key: 47 })).toBe(s);
    expect(bookSelectionReducer(s, { type: "book", keys: KEYS })).toBe(s);
  });
});
