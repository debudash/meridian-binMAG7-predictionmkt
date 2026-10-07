import { expect } from "chai";
import { checkPythQuality, pythPriceToE6 } from "../src/pyth/quality";

describe("pyth quality helpers", () => {
  it("converts expo -8 price to e6", () => {
    expect(pythPriceToE6(18_000_000_000n, -8).toString()).to.equal("180000000");
  });

  it("rejects stale samples", () => {
    const r = checkPythQuality(
      {
        price: 18_000_000_000n,
        conf: 1000n,
        expo: -8,
        publishSlot: 100n,
        slotNow: 400n,
      },
      { maxStalenessSlots: 150n, maxConfRatioBps: 500 }
    );
    expect(r.ok).to.equal(false);
  });

  it("accepts fresh tight conf", () => {
    const r = checkPythQuality(
      {
        price: 18_000_000_000n,
        conf: 1000n,
        expo: -8,
        publishSlot: 100n,
        slotNow: 110n,
      },
      { maxStalenessSlots: 150n, maxConfRatioBps: 500 }
    );
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.priceE6.toString()).to.equal("180000000");
  });
});
