/**
 * DLV-116 / docs/ui/08-price-display.md: one helper for executable prices + implied.
 * Debu on Trade AMZN ≥ 190 read the header mid 0.42 / 0.58 as tradable while the book was ask 0.43 / bid 0.41.
 */
import { describe, expect, it } from "vitest";
import {
  NO_BUYERS_TITLE,
  NO_SELLERS_TITLE,
  execLabel,
  execTitle,
  formatPrice,
  impliedText,
  marketPriceDisplay,
  priceDisplay,
  spreadText,
} from "./priceDisplay";

const AMZN = { bestBid: 0.41, bestAsk: 0.43, lastYes: 0.42, tickSize: 0.01 };

describe("priceDisplay core", () => {
  it("AMZN bid 0.41 / ask 0.43 → four executables + 42% implied", () => {
    const d = priceDisplay(AMZN);
    expect(d.exec).toEqual({ "buy-yes": 0.43, "buy-no": 0.59, "sell-yes": 0.41, "sell-no": 0.57 });
    expect(execLabel(d, "buy-yes")).toBe("0.43");
    expect(execLabel(d, "buy-no")).toBe("0.59");
    expect(execLabel(d, "sell-yes")).toBe("0.41");
    expect(execLabel(d, "sell-no")).toBe("0.57");
    expect(impliedText(d)).toBe("42% implied");
    expect(spreadText(d)).toBe("Spread 0.02 · 42% implied");
  });

  it("Buy Yes + Buy No = 1 + spread (never 1.00); implied Yes + No = 100%", () => {
    const d = priceDisplay(AMZN);
    expect(Math.round((d.exec["buy-yes"]! + d.exec["buy-no"]!) * 100)).toBe(102);
    expect(d.impliedPct! + (100 - d.impliedPct!)).toBe(100);
  });

  it("integer-tick math with tickSize 0.005 (3 decimals, no float noise)", () => {
    const d = priceDisplay({ bestBid: 0.415, bestAsk: 0.425, tickSize: 0.005 });
    expect(d.exec).toEqual({ "buy-yes": 0.425, "buy-no": 0.585, "sell-yes": 0.415, "sell-no": 0.575 });
    expect(execLabel(d, "buy-no")).toBe("0.585");
    expect(execLabel(d, "sell-no")).toBe("0.575");
    expect(impliedText(d)).toBe("42% implied");
    expect(spreadText(d)).toBe("Spread 0.010 · 42% implied");
  });

  it("integer-tick math with tickSize 0.05 (mid between ticks rounds half up)", () => {
    const d = priceDisplay({ bestBid: 0.4, bestAsk: 0.45, tickSize: 0.05 });
    expect(d.exec).toEqual({ "buy-yes": 0.45, "buy-no": 0.6, "sell-yes": 0.4, "sell-no": 0.55 });
    expect(execLabel(d, "buy-no")).toBe("0.60");
    expect(d.impliedPct).toBe(43);
  });

  it("caps: executables 0.01–0.99, implied 1–99% (never 100% from 0.995)", () => {
    const hi = priceDisplay({ bestBid: 0.99, bestAsk: 1.0, tickSize: 0.005 });
    expect(hi.exec["buy-yes"]).toBe(0.99);
    expect(hi.impliedPct).toBe(99);
    expect(impliedText(hi)).toBe("99% implied");
    const lo = priceDisplay({ bestBid: 0.0, bestAsk: 0.005, tickSize: 0.005 });
    expect(lo.exec["buy-no"]).toBe(0.99);
    expect(lo.exec["sell-yes"]).toBe(0.01);
    expect(lo.impliedPct).toBe(1);
    expect(priceDisplay({ lastYes: 0.996 }).impliedPct).toBe(99);
  });

  it("missing ask: Buy Yes / Sell No show — with the no-sellers / no-buyers tooltip; implied from last trade", () => {
    const d = priceDisplay({ bestBid: 0.41, lastYes: 0.4, tickSize: 0.01 });
    expect(execLabel(d, "buy-yes")).toBe("—");
    expect(execLabel(d, "sell-no")).toBe("—");
    expect(execLabel(d, "buy-no")).toBe("0.59");
    expect(execTitle(d, "buy-yes")).toBe(NO_SELLERS_TITLE);
    expect(execTitle(d, "sell-no")).toBe(NO_BUYERS_TITLE);
    expect(execTitle(d, "buy-no")).toBeUndefined();
    expect(NO_SELLERS_TITLE).toBe("No sellers right now — set a limit price");
    expect(NO_BUYERS_TITLE).toBe("No buyers right now");
    expect(impliedText(d)).toBe("40% implied (last trade)");
    expect(spreadText(d)).toBeNull();
  });

  it("missing bid and no last trade: implied —", () => {
    const d = priceDisplay({ bestAsk: 0.43 });
    expect(execLabel(d, "sell-yes")).toBe("—");
    expect(execTitle(d, "buy-no")).toBe(NO_SELLERS_TITLE);
    expect(impliedText(d)).toBe("—");
  });

  it("closed / settled: no executables, no liquidity tooltips", () => {
    const d = priceDisplay({ ...AMZN, open: false });
    expect(d.exec).toEqual({ "buy-yes": undefined, "buy-no": undefined, "sell-yes": undefined, "sell-no": undefined });
    expect(execTitle(d, "buy-yes")).toBeUndefined();
  });

  it("formatPrice: — for missing, tick decimals otherwise", () => {
    expect(formatPrice(undefined, 0.01)).toBe("—");
    expect(formatPrice(0.5, 0.01)).toBe("0.50");
    expect(formatPrice(0.575, 0.005)).toBe("0.575");
  });
});

describe("marketPriceDisplay adapter", () => {
  const m = { yesBid: 0.41, yesAsk: 0.43, lastYes: 0.42, yesMid: 0.42, tickSize: 0.01, status: "open" as const };
  it("uses the market's top of book; a live book replaces it entirely", () => {
    expect(marketPriceDisplay(m).exec["buy-yes"]).toBe(0.43);
    const live = { bids: [{ price: 0.4, size: 5 }], asks: [{ price: 0.44, size: 5 }] };
    const d = marketPriceDisplay(m, { book: live });
    expect([d.exec["buy-yes"], d.exec["buy-no"]]).toEqual([0.44, 0.6]);
    const oneSided = marketPriceDisplay(m, { book: { bids: [{ price: 0.4, size: 5 }], asks: [] } });
    expect(oneSided.exec["buy-yes"]).toBeUndefined();
  });
  it("never uses yesMid as an executable or a bare mid; settled markets have no executables", () => {
    expect(marketPriceDisplay({ ...m, yesBid: undefined, yesAsk: undefined, lastYes: undefined }).impliedSource).toBe("none");
    expect(marketPriceDisplay({ ...m, status: "settled-yes" }).exec["buy-yes"]).toBeUndefined();
    expect(marketPriceDisplay(m, { open: false }).exec["buy-no"]).toBeUndefined();
  });
});
