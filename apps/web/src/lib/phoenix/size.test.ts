import { describe, expect, it } from "vitest";
import { contractsToRawAmounts, DEFAULT_OUTCOME_DECIMALS } from "./size";

/**
 * Buy No sizing invariant (Reviewer High):
 * mint raw must equal Phoenix sizeInBaseUnits for the same contract count
 * given decimals=6 and Phoenix base atoms == SPL atoms (docs/units.md).
 */
describe("contractsToRawAmounts", () => {
  it("defaults to 6 decimals", () => {
    expect(DEFAULT_OUTCOME_DECIMALS).toBe(6);
  });

  it("Buy No: mint raw == phoenix base units (size=10, decimals=6)", () => {
    const sized = contractsToRawAmounts(10, 6);
    expect(sized.mintRaw).toBe(10_000_000);
    expect(sized.phoenixBaseUnits).toBe(10_000_000);
    expect(sized.mintRaw).toBe(sized.phoenixBaseUnits);
  });

  it("fractional contracts round consistently for both legs", () => {
    const sized = contractsToRawAmounts(2.5, 6);
    expect(sized.mintRaw).toBe(2_500_000);
    expect(sized.phoenixBaseUnits).toBe(sized.mintRaw);
  });

  it("size=1 → 1e6 raw", () => {
    const sized = contractsToRawAmounts(1);
    expect(sized.mintRaw).toBe(1_000_000);
    expect(sized.phoenixBaseUnits).toBe(1_000_000);
  });
});
