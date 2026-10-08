/**
 * Phoenix trader-account reader (DLV-087).
 *
 * Phoenix V1 credits a maker's fills to its trader account ("seat") on the market, not to the
 * wallet: resting Buy Yes fills land as free base lots (Yes), resting sells as free quote lots
 * (USDC). This turns a loaded MarketState into seat balances (contracts / USDC) and the
 * trader's own resting orders, keeping the raw on-chain OrderId for cancel instructions.
 */

type Bignum = number | { toString(base?: number): string };

export interface PhoenixMarketLike {
  data: {
    bids: ReadonlyArray<readonly [{ priceInTicks: Bignum; orderSequenceNumber: Bignum }, { traderIndex: Bignum; numBaseLots: Bignum }]>;
    asks: ReadonlyArray<readonly [{ priceInTicks: Bignum; orderSequenceNumber: Bignum }, { traderIndex: Bignum; numBaseLots: Bignum }]>;
    traders: Map<string, { quoteLotsFree: Bignum; quoteLotsLocked: Bignum; baseLotsFree: Bignum; baseLotsLocked: Bignum }>;
    traderPubkeyToTraderIndex: Map<string, number>;
  };
  ticksToFloatPrice(ticks: number): number;
  baseLotsToRawBaseUnits(baseLots: number): number;
  quoteLotsToQuoteUnits(quoteLots: number): number;
}

export interface PhoenixOpenOrder {
  /** Stable key: `${side}:${priceInTicks}:${orderSequenceNumber}` */
  id: string;
  /** bid = buying Yes, ask = selling Yes (book is Yes/USDC) */
  side: "bid" | "ask";
  /** Yes price 0–1 */
  price: number;
  /** Remaining contracts */
  size: number;
  /** Raw on-chain OrderId parts (decimal strings) — pass back unchanged to cancel */
  priceInTicks: string;
  orderSequenceNumber: string;
}

export interface PhoenixSeatBalances {
  /** Yes contracts withdrawable now (e.g. resting Buy Yes fills) */
  yesFree: number;
  /** Yes contracts backing resting asks */
  yesLocked: number;
  /** USDC withdrawable now (e.g. resting sell fills, cancelled bids) */
  usdcFree: number;
  /** USDC backing resting bids */
  usdcLocked: number;
}

export interface PhoenixTraderSnapshot {
  phoenixMarket: string;
  seat: PhoenixSeatBalances;
  orders: PhoenixOpenOrder[];
}

function num(x: Bignum): number {
  return typeof x === "number" ? x : Number(x.toString());
}
function str(x: Bignum): string {
  return typeof x === "number" ? String(x) : x.toString(10);
}
/** Float noise from lot conversions (e.g. 0.30000000000000004) → 6 dp like the token. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

export function extractTraderSnapshot(
  market: PhoenixMarketLike,
  phoenixMarket: string,
  trader: string,
): PhoenixTraderSnapshot | null {
  const state = market.data.traders.get(trader);
  if (!state) return null;
  const seat: PhoenixSeatBalances = {
    yesFree: round6(market.baseLotsToRawBaseUnits(num(state.baseLotsFree))),
    yesLocked: round6(market.baseLotsToRawBaseUnits(num(state.baseLotsLocked))),
    usdcFree: round6(market.quoteLotsToQuoteUnits(num(state.quoteLotsFree))),
    usdcLocked: round6(market.quoteLotsToQuoteUnits(num(state.quoteLotsLocked))),
  };
  const idx = market.data.traderPubkeyToTraderIndex.get(trader);
  const orders: PhoenixOpenOrder[] = [];
  if (idx != null) {
    for (const [side, book] of [
      ["bid", market.data.bids],
      ["ask", market.data.asks],
    ] as const) {
      for (const [orderId, resting] of book) {
        if (num(resting.traderIndex) !== idx) continue;
        const ticks = str(orderId.priceInTicks);
        const seq = str(orderId.orderSequenceNumber);
        orders.push({
          id: `${side}:${ticks}:${seq}`,
          side,
          price: round6(market.ticksToFloatPrice(num(orderId.priceInTicks))),
          size: round6(market.baseLotsToRawBaseUnits(num(resting.numBaseLots))),
          priceInTicks: ticks,
          orderSequenceNumber: seq,
        });
      }
    }
  }
  return { phoenixMarket, seat, orders };
}
