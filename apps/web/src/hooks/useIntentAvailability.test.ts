/**
 * Hook wraps pure getIntentAvailability — unit-test the pure path via the same
 * fixtures the hook uses when connected (demo positions).
 */
import { describe, expect, it } from "vitest";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import { getDemoOpenOrders, getDemoPosition } from "@/lib/demo/portfolio";

describe("useIntentAvailability demo wiring", () => {
  it("AAPL fixture holds Yes → Buy No blocked", () => {
    const position = getDemoPosition("fixture-aapl-230-oct16");
    const orders = getDemoOpenOrders("fixture-aapl-230-oct16");
    const a = getIntentAvailability(
      position,
      orders,
      { pendingTradeCount: 0 },
      { lifecycle: "open", lotSize: 1 },
    );
    expect(position.yesQty).toBe(40);
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["sell-yes"].enabled).toBe(true);
  });

  it("NVDA fixture holds No → Buy Yes blocked", () => {
    const position = getDemoPosition("fixture-nvda-140-soon");
    const a = getIntentAvailability(
      position,
      getDemoOpenOrders("fixture-nvda-140-soon"),
      { pendingTradeCount: 0 },
      { lifecycle: "open", lotSize: 1 },
    );
    expect(position.noQty).toBe(25);
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(true);
  });

  it("MSFT open Buy Yes orders block Buy No when flat", () => {
    const position = getDemoPosition("fixture-msft-420");
    const orders = getDemoOpenOrders("fixture-msft-420");
    expect(position.yesQty).toBe(0);
    expect(orders.openBuyYesQty).toBe(15);
    const a = getIntentAvailability(
      position,
      orders,
      { pendingTradeCount: 0 },
      { lifecycle: "open", lotSize: 1 },
    );
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].copy).toMatch(/open Buy Yes/i);
  });

  it("unknown market is flat", () => {
    const position = getDemoPosition("no-such-market");
    expect(position.yesQty).toBe(0);
    expect(position.noQty).toBe(0);
  });
});
