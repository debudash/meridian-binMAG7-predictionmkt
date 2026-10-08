/**
 * DLV-087 — read a wallet's Phoenix trader account (seat balances + resting orders) from a
 * loaded Phoenix MarketState. Yes/USDC book: base = Yes (6 dp), quote = USDC (6 dp).
 */
import { describe, expect, it } from "vitest";
import BN from "bn.js";
import { extractTraderSnapshot, type PhoenixMarketLike } from "./phoenixTrader";

const ME = "G5dtmt73NNcDramXQUr6ckfNP9umAWwjpRwsMh7jUTLY";
const OTHER = "3qoPBdbha3Ymc7SR9n34tD2Di6tnvgKnEiJT7rVa9uJ6";

/** 1 contract = 1000 base lots; 1 USDC = 1000 quote lots; 1 tick = $0.01. */
function market(over: Partial<PhoenixMarketLike["data"]> = {}): PhoenixMarketLike {
  return {
    data: {
      bids: [],
      asks: [],
      traders: new Map(),
      traderPubkeyToTraderIndex: new Map(),
      ...over,
    },
    ticksToFloatPrice: (t) => t / 100,
    baseLotsToRawBaseUnits: (l) => l / 1000,
    quoteLotsToQuoteUnits: (l) => l / 1000,
  };
}
const seat = (qf: number, ql: number, bf: number, bl: number) => ({
  quoteLotsFree: new BN(qf),
  quoteLotsLocked: new BN(ql),
  baseLotsFree: new BN(bf),
  baseLotsLocked: new BN(bl),
});
const order = (ticks: number, seq: string, traderIndex: number, lots: number) =>
  [
    { priceInTicks: new BN(ticks), orderSequenceNumber: new BN(seq) },
    { traderIndex: new BN(traderIndex), numBaseLots: new BN(lots), lastValidSlot: new BN(0), lastValidUnixTimestampInSeconds: new BN(0) },
  ] as const;

describe("extractTraderSnapshot", () => {
  it("no seat on this market → null", () => {
    expect(extractTraderSnapshot(market(), "PHX", ME)).toBeNull();
  });

  it("seat balances in contracts / USDC (resting fill stuck in the seat: 4 Yes free)", () => {
    const m = market({
      traders: new Map([[ME, seat(1500, 2700, 4000, 0)]]),
      traderPubkeyToTraderIndex: new Map([[ME, 3]]),
    });
    const s = extractTraderSnapshot(m, "PHX", ME)!;
    expect(s.phoenixMarket).toBe("PHX");
    expect(s.seat).toEqual({ yesFree: 4, yesLocked: 0, usdcFree: 1.5, usdcLocked: 2.7 });
    expect(s.orders).toEqual([]);
  });

  it("lists only this trader's resting orders with price, remaining size and raw cancel ids", () => {
    // Bid sequence numbers are stored bit-inverted on-chain; we keep the raw stored value for cancel.
    const rawBidSeq = new BN("18446744073709551610").toString();
    const m = market({
      bids: [order(45, rawBidSeq, 3, 6000), order(44, "18446744073709551600", 7, 9000)] as never,
      asks: [order(60, "12", 3, 2000), order(61, "13", 7, 5000)] as never,
      traders: new Map([[ME, seat(0, 2700, 0, 2000)], [OTHER, seat(0, 0, 0, 0)]]),
      traderPubkeyToTraderIndex: new Map([[ME, 3], [OTHER, 7]]),
    });
    const s = extractTraderSnapshot(m, "PHX", ME)!;
    expect(s.orders).toEqual([
      { id: `bid:45:${rawBidSeq}`, side: "bid", price: 0.45, size: 6, priceInTicks: "45", orderSequenceNumber: rawBidSeq },
      { id: "ask:60:12", side: "ask", price: 0.6, size: 2, priceInTicks: "60", orderSequenceNumber: "12" },
    ]);
    expect(s.seat.yesLocked).toBe(2);
  });

  it("accepts plain-number bignums too", () => {
    const m = market({
      traders: new Map([[ME, { quoteLotsFree: 0, quoteLotsLocked: 0, baseLotsFree: 1000, baseLotsLocked: 0 }]]),
      traderPubkeyToTraderIndex: new Map([[ME, 1]]),
    });
    expect(extractTraderSnapshot(m, "PHX", ME)!.seat.yesFree).toBe(1);
  });
});
