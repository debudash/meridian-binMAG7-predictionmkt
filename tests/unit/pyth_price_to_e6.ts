/**
 * S-10 — units.md §8 pyth_price_to_e6 vectors (pure unit; no accounts).
 */
import { expect } from "chai";
import { PYTH_TO_E6_VECTORS } from "../helpers/fixtures";
import { pythPriceToE6 } from "../helpers/harness";

describe("S-10 pyth_price_to_e6 (units.md §8)", () => {
  for (const row of PYTH_TO_E6_VECTORS) {
    it(`S-10: price=${row.price} expo=${row.expo} → e6=${row.expectedE6} (${row.note})`, () => {
      if (row.expectedE6 === 0n) {
        expect(() => pythPriceToE6(row.price, row.expo)).to.throw("InvalidPythPrice");
        return;
      }
      const got = pythPriceToE6(row.price, row.expo);
      expect(got).to.equal(row.expectedE6);
    });
  }
});
