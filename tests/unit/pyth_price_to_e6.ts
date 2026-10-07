/**
 * S-10 — units.md §8 pyth_price_to_e6 vectors (pure unit; no accounts).
 * Stays RED until Engineers land utils/pyth.rs (or export a TS twin into harness).
 */
import { expect } from "chai";
import { PYTH_TO_E6_VECTORS } from "../helpers/fixtures";
import { pythPriceToE6, TddRedError } from "../helpers/harness";

describe("S-10 pyth_price_to_e6 (units.md §8)", () => {
  for (const row of PYTH_TO_E6_VECTORS) {
    it(`S-10: price=${row.price} expo=${row.expo} → e6=${row.expectedE6} (${row.note})`, () => {
      try {
        const got = pythPriceToE6(row.price, row.expo);
        if (row.expectedE6 === 0n) {
          // Program should reject e6==0 as InvalidPythPrice for equities.
          expect.fail("S-10: expected InvalidPythPrice for zero e6 — wire reject path");
        }
        expect(got).to.equal(row.expectedE6);
      } catch (e) {
        expect(e).to.be.instanceOf(TddRedError);
        throw e;
      }
    });
  }
});
