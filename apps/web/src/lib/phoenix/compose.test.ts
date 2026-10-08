import { describe, expect, it } from "vitest";
import {
  effectiveYesLimitPrice,
  planIntentComposition,
  snapYesPrice,
  ticketPhoenixOrderType,
  POST_ONLY_ENABLED,
} from "./compose";
import { intentToBookAction } from "@/lib/market/bookTransform";

describe("planIntentComposition", () => {
  it("Buy Yes → bid at p", () => {
    const plan = planIntentComposition({
      intent: "buy-yes",
      price: 0.62,
      size: 10,
      orderType: "limit",
    });
    expect(plan.phoenixSide).toBe("bid");
    expect(plan.yesPrice).toBe(0.62);
    expect(plan.needsMint).toBe(false);
    expect(plan.needsMerge).toBe(false);
    expect(plan.packaging).toBe("phoenix-only");
  });

  it("Sell Yes → ask at p", () => {
    const plan = planIntentComposition({
      intent: "sell-yes",
      price: 0.55,
      size: 5,
      orderType: "limit",
    });
    expect(plan.phoenixSide).toBe("ask");
    expect(plan.yesPrice).toBe(0.55);
    expect(plan.packaging).toBe("phoenix-only");
  });

  it("Buy No → mint + ask Yes at 1−p_no", () => {
    const pNo = 0.4;
    const plan = planIntentComposition({
      intent: "buy-no",
      price: pNo,
      size: 25,
      orderType: "limit",
    });
    expect(plan.needsMint).toBe(true);
    expect(plan.phoenixSide).toBe("ask");
    expect(plan.yesPrice).toBeCloseTo(0.6, 8);
    expect(plan.packaging).toBe("mint-then-phoenix");
    expect(plan.notes.some((n) => /Transient Yes\+No/i.test(n))).toBe(true);
  });

  it("Sell No market → bid Yes + immediate merge_pair", () => {
    const pNo = 0.35;
    const plan = planIntentComposition({
      intent: "sell-no",
      price: pNo,
      size: 8,
      orderType: "market",
    });
    expect(plan.phoenixSide).toBe("bid");
    expect(plan.yesPrice).toBeCloseTo(0.65, 8);
    expect(plan.needsMerge).toBe(true);
    expect(plan.mergeBlocked).toBe(false);
    expect(plan.packaging).toBe("phoenix-then-merge");
    expect(plan.notes.some((n) => /merge_pair/i.test(n))).toBe(true);
  });

  it("Sell No limit → resting bid; merge-on-fill caveat", () => {
    const plan = planIntentComposition({
      intent: "sell-no",
      price: 0.35,
      size: 8,
      orderType: "limit",
    });
    expect(plan.phoenixSide).toBe("bid");
    expect(plan.needsMerge).toBe(true);
    expect(plan.mergeBlocked).toBe(true);
    expect(plan.packaging).toBe("phoenix-then-merge-todo");
    expect(plan.notes.some((n) => /resting|not automatic/i.test(n))).toBe(true);
  });

  it("snaps Yes↔No price transform with tick math", () => {
    const action = intentToBookAction("buy-no");
    const yes = action.priceFromUser(0.33);
    expect(snapYesPrice(yes, 0.01)).toBe(0.67);
  });

  it("market order uses worstPrice for Yes limit", () => {
    const plan = planIntentComposition({
      intent: "buy-yes",
      price: 0.5,
      size: 1,
      orderType: "market",
      worstPrice: 0.55,
    });
    expect(effectiveYesLimitPrice(plan, 0.55)).toBe(0.55);
  });

  it("Buy No market worstPrice transforms to Yes", () => {
    const plan = planIntentComposition({
      intent: "buy-no",
      price: 0.4,
      size: 1,
      orderType: "market",
      worstPrice: 0.42,
    });
    // worst p_no 0.42 → yes ask limit 0.58
    expect(effectiveYesLimitPrice(plan, 0.42)).toBeCloseTo(0.58, 8);
  });

  it("post-only Buy Yes packs as phoenix-only ask/bid", () => {
    const plan = planIntentComposition({
      intent: "buy-yes",
      price: 0.5,
      size: 3,
      orderType: "post-only",
    });
    expect(plan.orderType).toBe("post-only");
    expect(plan.phoenixSide).toBe("bid");
  });
});

describe("ticketPhoenixOrderType (D-021: post-only hidden in V1)", () => {
  it("is off", () => {
    expect(POST_ONLY_ENABLED).toBe(false);
  });
  it("passes market/limit through", () => {
    expect(ticketPhoenixOrderType("market")).toBe("market");
    expect(ticketPhoenixOrderType("limit")).toBe("limit");
  });
  it("never sends post-only, even if a caller asks for it", () => {
    expect(ticketPhoenixOrderType("limit", true)).toBe("limit");
    expect(ticketPhoenixOrderType("market", true)).toBe("market");
  });
});

/** L8 (Reviewers, !54): market worst price = touch ± 0.02, clamped to the market's price band. */
import { marketWorstPrice } from "./compose";

describe("marketWorstPrice (L8)", () => {
  const band = { minPrice: 0.01, maxPrice: 0.99 };
  it("buy adds, sell subtracts the slippage", () => {
    expect(marketWorstPrice(0.5, true, band)).toBeCloseTo(0.52);
    expect(marketWorstPrice(0.5, false, band)).toBeCloseTo(0.48);
  });
  it("clamps into [minPrice, maxPrice]", () => {
    expect(marketWorstPrice(0.98, true, band)).toBe(0.99);
    expect(marketWorstPrice(0.02, false, band)).toBe(0.01);
  });
  it("Buy No at p_no 0.98 → Yes limit stays ≥ 0.01 (used to be ≤ 0)", () => {
    const plan = planIntentComposition({ intent: "buy-no", price: 0.98, size: 1, orderType: "market", tickSize: 0.01 });
    const yes = effectiveYesLimitPrice(plan, marketWorstPrice(0.98, true, band), 0.01);
    expect(yes).toBeGreaterThanOrEqual(0.01);
  });
});
