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

  it("maps settle fields for the proof card (DLV-076)", () => {
    const sym = Buffer.alloc(8);
    Buffer.from("NVDA").copy(sym);
    const feed = new Array(32).fill(0).map((_, i) => i);
    const view = mapStrikeMarketToView("m3", {
      equitySymbol: [...sym],
      strikePriceE6: 140_000_000,
      expiryTs: 1,
      status: 3,
      settlementPriceE6: 138_250_000,
      settledAtTs: 1_791_500_000,
      settledSlot: 777,
      pythFeedId: feed,
    });
    expect(view.status).toBe("settled-no");
    expect(view.resolvedPrice).toBe(138.25);
    expect(view.resolvedAt).toBe(1_791_500_000);
    expect(view.settledSlot).toBe(777);
    expect(view.pythFeedIdHex).toBe(feed.map((b) => b.toString(16).padStart(2, "0")).join(""));
    expect(mapStrikeMarketToView("m4", { pythFeedId: new Array(32).fill(0) }).pythFeedIdHex).toBeUndefined();
  });
});
