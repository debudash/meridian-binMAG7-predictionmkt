/**
 * Pure unit tests for on-book compose planner (no validator).
 */
import { expect } from "chai";
import {
  planIntentComposition,
  quoteAtomsForYesFill,
  contractsToRaw,
  snapYesPrice,
} from "../helpers/phoenix_compose";

describe("phoenix_compose (unit)", () => {
  it("Buy No → mint-then-phoenix ask at 1−p_no", () => {
    const p = planIntentComposition({
      intent: "buy-no",
      price: 0.4,
      size: 2,
      orderType: "market",
    });
    expect(p.needsMint).to.equal(true);
    expect(p.phoenixSide).to.equal("ask");
    expect(p.yesPrice).to.equal(snapYesPrice(0.6));
    expect(p.packaging).to.equal("mint-then-phoenix");
  });

  it("Sell No market → phoenix-then-merge", () => {
    const p = planIntentComposition({
      intent: "sell-no",
      price: 0.35,
      size: 1,
      orderType: "market",
    });
    expect(p.needsMerge).to.equal(true);
    expect(p.mergeBlocked).to.equal(false);
    expect(p.packaging).to.equal("phoenix-then-merge");
  });

  it("contractsToRaw + quoteAtoms align with size unify", () => {
    expect(contractsToRaw(10).toString()).to.equal("10000000");
    expect(quoteAtomsForYesFill(10_000_000n, 0.5).toString()).to.equal("5000000");
  });
});
