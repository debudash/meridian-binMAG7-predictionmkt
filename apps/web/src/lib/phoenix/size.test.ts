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

  it("legacy helper is not lot-aware (placement uses contractsToLots, M1)", () => {
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

/**
 * M1 (Reviewers, !54): Phoenix floors sizes to whole base lots while the mint used the exact
 * amount, so a fractional Buy No (2.5, or float error like 0.29 × 100 → 28) left Yes + No behind.
 * Sizes must be whole lots, and mint raw + Phoenix lots must come from the same integer lot count.
 */
import { contractsToLots, lotSizeError, SizeNotLotAlignedError } from "./size";

/** Exactly what @ellipsis-labs/phoenix-sdk does in *fromTemplate (rawBaseUnitsToBaseLotsRoundedDown). */
function sdkLots(sizeInBaseUnits: number, m: { baseLotsPerBaseUnit: number; rawBaseUnitsPerBaseUnit: number }) {
  return Math.floor((sizeInBaseUnits / m.rawBaseUnitsPerBaseUnit) * m.baseLotsPerBaseUnit);
}

const WHOLE_CONTRACT_LOT = { baseLotSize: 1_000_000, baseLotsPerBaseUnit: 1, rawBaseUnitsPerBaseUnit: 1 };
const CENT_CONTRACT_LOT = { baseLotSize: 10_000, baseLotsPerBaseUnit: 100, rawBaseUnitsPerBaseUnit: 1 };

describe("lotSizeError (ticket + client pre-sign check)", () => {
  it("refuses fractional / float-error sizes on a 1-contract lot", () => {
    expect(lotSizeError(2.5, 1)).toMatch(/whole/i);
    expect(lotSizeError(0.29, 1)).toMatch(/whole/i);
    expect(lotSizeError(10.000001, 1)).toMatch(/whole/i);
  });
  it("refuses non-finite, zero and negative sizes", () => {
    for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(lotSizeError(s, 1)).not.toBeNull();
  });
  it("accepts whole multiples of the lot", () => {
    expect(lotSizeError(1, 1)).toBeNull();
    expect(lotSizeError(10, 1)).toBeNull();
    expect(lotSizeError(0.29, 0.01)).toBeNull();
    expect(lotSizeError(2.5, 0.5)).toBeNull();
    expect(lotSizeError(2.505, 0.01)).not.toBeNull();
  });
});

describe("contractsToLots (authoritative, from the loaded Phoenix market)", () => {
  it("1-contract lot: 3 → 3 lots, mint raw = lots × raw-per-lot, SDK floors to the same 3 lots", () => {
    const s = contractsToLots(3, WHOLE_CONTRACT_LOT, 6);
    expect(s.numBaseLots).toBe(3);
    expect(s.mintRaw).toBe(3 * WHOLE_CONTRACT_LOT.baseLotSize);
    expect(sdkLots(s.phoenixBaseUnits, WHOLE_CONTRACT_LOT)).toBe(3);
  });
  it("1-contract lot: Buy No 2.5 and 0.29 are refused before signing", () => {
    expect(() => contractsToLots(2.5, WHOLE_CONTRACT_LOT, 6)).toThrow(SizeNotLotAlignedError);
    expect(() => contractsToLots(0.29, WHOLE_CONTRACT_LOT, 6)).toThrow(SizeNotLotAlignedError);
    expect(() => contractsToLots(0, WHOLE_CONTRACT_LOT, 6)).toThrow(SizeNotLotAlignedError);
  });
  it("0.01-contract lot: 0.29 → 29 lots on both legs (naive float floor would give Phoenix 28)", () => {
    expect(sdkLots(0.29, CENT_CONTRACT_LOT)).toBe(28); // the float hazard this guards against
    const s = contractsToLots(0.29, CENT_CONTRACT_LOT, 6);
    expect(s.numBaseLots).toBe(29);
    expect(s.mintRaw).toBe(290_000);
    expect(sdkLots(s.phoenixBaseUnits, CENT_CONTRACT_LOT)).toBe(29);
  });
  it("mint raw always equals Phoenix lots × raw-per-lot across many sizes", () => {
    for (let lots = 1; lots <= 2000; lots += 7) {
      const contracts = lots / 100;
      const s = contractsToLots(contracts, CENT_CONTRACT_LOT, 6);
      expect(s.numBaseLots).toBe(lots);
      expect(sdkLots(s.phoenixBaseUnits, CENT_CONTRACT_LOT)).toBe(lots);
      expect(s.mintRaw).toBe(lots * CENT_CONTRACT_LOT.baseLotSize);
    }
  });
  it("refuses a market whose lot units don't match the outcome decimals", () => {
    expect(() => contractsToLots(1, { baseLotSize: 1_000, baseLotsPerBaseUnit: 1, rawBaseUnitsPerBaseUnit: 1 }, 6)).toThrow();
  });
});
