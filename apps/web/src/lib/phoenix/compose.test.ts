import { describe, expect, it } from "vitest";
import {
  effectiveYesLimitPrice,
  planIntentComposition,
  snapYesPrice,
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

  it("Sell No → bid Yes at 1−p_no; merge blocked (Schema TODO)", () => {
    const pNo = 0.35;
    const plan = planIntentComposition({
      intent: "sell-no",
      price: pNo,
      size: 8,
      orderType: "ioc" as never,
    });
    // orderType passthrough — use market
    const plan2 = planIntentComposition({
      intent: "sell-no",
      price: pNo,
      size: 8,
      orderType: "market",
    });
    expect(plan2.phoenixSide).toBe("bid");
    expect(plan2.yesPrice).toBeCloseTo(0.65, 8);
    expect(plan2.needsMerge).toBe(true);
    expect(plan2.mergeBlocked).toBe(true);
    expect(plan2.packaging).toBe("phoenix-then-merge-todo");
    expect(plan2.notes.some((n) => /Schema/i.test(n))).toBe(true);
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
