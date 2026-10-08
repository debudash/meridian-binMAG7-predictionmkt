import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  buildStrikes,
  decodeEquitySymbol,
  encodeEquitySymbol,
  strikeMarketSeeds,
} from "../src/strikes";

describe("strike arg encoding", () => {
  it("encodes equity symbol as 8-byte space-padded ASCII", () => {
    const buf = encodeEquitySymbol("AAPL");
    expect(buf.length).to.equal(8);
    expect(buf.toString("utf8")).to.equal("AAPL    ");
    expect(decodeEquitySymbol(buf)).to.equal("AAPL");
  });

  it("truncates symbols longer than 8", () => {
    const buf = encodeEquitySymbol("VERYLONGSYM");
    expect(buf.length).to.equal(8);
    expect(decodeEquitySymbol(buf)).to.equal("VERYLONG");
  });

  it("builds prior-close ± offset strikes", () => {
    const strikes = buildStrikes({
      symbols: ["AAPL"],
      priorCloseE6: 180_000_000n,
      offsetsE6: [-5_000_000, 0, 5_000_000],
      expiryTs: 1_700_000_000,
    });
    expect(strikes).to.have.length(3);
    expect(strikes.map((s) => s.strikePriceE6.toString())).to.deep.equal([
      "175000000",
      "180000000",
      "185000000",
    ]);
    expect(strikes[0].expiryTs.toString()).to.equal("1700000000");
    expect(strikes[0].pythFeedId.length).to.equal(32);
  });

  it("derives stable strike_market PDA seeds", () => {
    const programId = new PublicKey("3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj");
    const equity = encodeEquitySymbol("AAPL");
    const strikes = buildStrikes({
      symbols: ["AAPL"],
      priorCloseE6: 180_000_000n,
      offsetsE6: [0],
      expiryTs: 1_700_000_000,
    });
    const [a] = strikeMarketSeeds(
      programId,
      equity,
      strikes[0].expiryTs,
      strikes[0].strikePriceE6
    );
    const [b] = strikeMarketSeeds(
      programId,
      equity,
      strikes[0].expiryTs,
      strikes[0].strikePriceE6
    );
    expect(a.equals(b)).to.equal(true);
  });

  it("rejects non-positive strike", () => {
    expect(() =>
      buildStrikes({
        symbols: ["AAPL"],
        priorCloseE6: 1_000_000n,
        offsetsE6: [-2_000_000],
        expiryTs: 1,
      })
    ).to.throw(/must be > 0/);
  });
});
