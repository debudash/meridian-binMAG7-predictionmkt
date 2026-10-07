import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mapStrikeMarketToView } from "./mapStrikeMarket";

describe("mapStrikeMarketToView", () => {
  it("maps open StrikeMarket fields to MarketView", () => {
    const sym = Buffer.alloc(8);
    Buffer.from("AAPL").copy(sym);
    const view = mapStrikeMarketToView("Market111111111111111111111111111111111", {
      equitySymbol: [...sym],
      strikePriceE6: 230_000_000,
      expiryTs: 1_800_000_000,
      status: 0,
      yesMint: Keypair.generate().publicKey,
      noMint: Keypair.generate().publicKey,
      phoenixMarket: Keypair.generate().publicKey,
      pythPriceFeed: Keypair.generate().publicKey,
    });
    expect(view.underlyingSymbol).toBe("AAPL");
    expect(view.strike).toBe(230);
    expect(view.status).toBe("open");
    expect(view.comparator).toBe(">=");
    expect(view.tradingCloseTs).toBe(1_800_000_000);
    expect(view.phoenixMarket).toBeTruthy();
    expect(view.tickSize).toBe(0.01);
  });

  it("treats default/system phoenix as unset", () => {
    const sym = Buffer.alloc(8);
    Buffer.from("MSFT").copy(sym);
    const view = mapStrikeMarketToView("m2", {
      equitySymbol: [...sym],
      strikePriceE6: 100_000_000,
      expiryTs: 1,
      status: 2,
      phoenixMarket: PublicKey.default,
    });
    expect(view.phoenixMarket).toBeUndefined();
    expect(view.status).toBe("settled-yes");
    expect(view.outcome).toBe("yes");
  });
});
