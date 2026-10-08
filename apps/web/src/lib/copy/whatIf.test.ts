import { describe, expect, it } from "vitest";
import { distanceToStrike, signedUsd, usd, whatIfPayoff, winConditionFor } from "./whatIf";

const base = { symbol: "NVDA", strike: 140, whenShort: "Oct 14" };

describe("whatIfPayoff (DLV-075, D-005 ≥)", () => {
  it("Buy Yes: pays $1/contract if close ≥ strike; loses cost otherwise", () => {
    const r = whatIfPayoff({ ...base, intent: "buy-yes", size: 10, price: 0.44 })!;
    expect(r.sentence).toBe(
      "If NVDA closes ≥ $140.00 on Oct 14 you get $10.00 (+$5.60). If not, you lose $4.40.",
    );
    expect(r.cashNow).toBeCloseTo(4.4);
    expect(r.payoutIfWin).toBe(10);
    expect(r.net).toBeCloseTo(5.6);
  });

  it("Buy No: pays when close is BELOW strike", () => {
    const r = whatIfPayoff({ ...base, intent: "buy-no", size: 10, price: 0.57 })!;
    expect(r.sentence).toBe(
      "If NVDA closes below $140.00 on Oct 14 you get $10.00 (+$4.30). If not, you lose $5.70.",
    );
    expect(r.winCondition).toContain("below");
    expect(r.winCondition).not.toContain("≥");
  });

  it("Sell Yes: receive now, give up the ≥-strike payout", () => {
    const r = whatIfPayoff({ ...base, intent: "sell-yes", size: 10, price: 0.43 })!;
    expect(r.sentence).toBe(
      "You get $4.30 now. If NVDA closes ≥ $140.00 on Oct 14 you give up $10.00 (−$5.70 vs holding). If not, they would have paid $0.00.",
    );
    expect(r.cashNow).toBeCloseTo(4.3);
    expect(r.net).toBeCloseTo(-5.7);
  });

  it("Sell No: receive now, give up the below-strike payout", () => {
    const r = whatIfPayoff({ ...base, intent: "sell-no", size: 5, price: 0.55 })!;
    expect(r.sentence).toBe(
      "You get $2.75 now. If NVDA closes below $140.00 on Oct 14 you give up $5.00 (−$2.25 vs holding). If not, they would have paid $0.00.",
    );
  });

  it("Yes and No payouts at the same Yes price sum to the $1 pair", () => {
    const yes = whatIfPayoff({ ...base, intent: "buy-yes", size: 7, price: 0.31 })!;
    const no = whatIfPayoff({ ...base, intent: "buy-no", size: 7, price: 0.69 })!;
    expect(yes.cashNow + no.cashNow).toBeCloseTo(7);
    expect(yes.net + no.net).toBeCloseTo(7);
  });

  it("returns null for invalid size/price/strike", () => {
    expect(whatIfPayoff({ ...base, intent: "buy-yes", size: 0, price: 0.5 })).toBeNull();
    expect(whatIfPayoff({ ...base, intent: "buy-yes", size: -1, price: 0.5 })).toBeNull();
    expect(whatIfPayoff({ ...base, intent: "buy-yes", size: 10, price: 0 })).toBeNull();
    expect(whatIfPayoff({ ...base, intent: "buy-yes", size: 10, price: 1 })).toBeNull();
    expect(whatIfPayoff({ ...base, intent: "buy-yes", size: Number.NaN, price: 0.5 })).toBeNull();
    expect(whatIfPayoff({ ...base, strike: 0, intent: "buy-yes", size: 10, price: 0.5 })).toBeNull();
  });

  it("formats money", () => {
    expect(usd(4.4)).toBe("$4.40");
    expect(signedUsd(5.6)).toBe("+$5.60");
    expect(signedUsd(-5.7)).toBe("−$5.70");
    expect(signedUsd(0.001)).toBe("$0.00");
    expect(winConditionFor("yes", "AAPL", 230, "Oct 14")).toBe("AAPL closes ≥ $230.00 on Oct 14");
  });
});

describe("distanceToStrike", () => {
  it("below strike → needs +x% (move from current price)", () => {
    const d = distanceToStrike("NVDA", 138.2, 140)!;
    expect(d.priceLabel).toBe("NVDA $138.20");
    expect(d.distanceLabel).toBe("needs +1.3%");
    expect(d.leading).toBe("no");
    expect(d.movePct).toBeCloseTo(1.3025, 3);
  });

  it("above strike → is x% above strike", () => {
    const d = distanceToStrike("AAPL", 231.84, 230)!;
    expect(d.distanceLabel).toBe("is 0.8% above strike");
    expect(d.leading).toBe("yes");
  });

  it("exactly at strike counts as Yes (≥, D-005)", () => {
    const d = distanceToStrike("MSFT", 420, 420)!;
    expect(d.leading).toBe("yes");
    expect(d.distanceLabel).toBe("at strike (Yes if ≥)");
  });

  it("tiny gaps keep 2 decimals", () => {
    expect(distanceToStrike("TSLA", 249.95, 250)!.distanceLabel).toBe("needs +0.02%");
  });

  it("missing price → null (UI shows —)", () => {
    expect(distanceToStrike("NVDA", undefined, 140)).toBeNull();
    expect(distanceToStrike("NVDA", null, 140)).toBeNull();
    expect(distanceToStrike("NVDA", 0, 140)).toBeNull();
  });
});
