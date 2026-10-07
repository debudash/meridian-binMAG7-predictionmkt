import { describe, expect, it } from "vitest";
import { contractsToRawAmounts, DEFAULT_OUTCOME_DECIMALS } from "./size";

/**
 * Buy No sizing invariant:
 * Meridian mint raw (atoms) must cover exactly the Phoenix order size.
 * Phoenix SDK *fromTemplate* `sizeInBaseUnits` is raw base units (whole
 * tokens), so phoenixBaseUnits × 10^decimals == mintRaw.
 */
describe("contractsToRawAmounts", () => {
  it("defaults to 6 decimals", () => {
    expect(DEFAULT_OUTCOME_DECIMALS).toBe(6);
  });

  it("Buy No: mint raw covers phoenix size (size=10, decimals=6)", () => {
    const sized = contractsToRawAmounts(10, 6);
    expect(sized.mintRaw).toBe(10_000_000);
    expect(sized.phoenixBaseUnits).toBe(10);
    expect(sized.phoenixBaseUnits * 10 ** 6).toBe(sized.mintRaw);
  });

  it("fractional contracts round consistently for both legs", () => {
    const sized = contractsToRawAmounts(2.5, 6);
    expect(sized.mintRaw).toBe(2_500_000);
    expect(sized.phoenixBaseUnits).toBe(2.5);
  });

  it("size=1 → 1e6 raw, 1 Phoenix base unit", () => {
    const sized = contractsToRawAmounts(1);
    expect(sized.mintRaw).toBe(1_000_000);
    expect(sized.phoenixBaseUnits).toBe(1);
  });
});
