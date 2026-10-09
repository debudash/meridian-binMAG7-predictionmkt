/**
 * Operator copilot, step 1 of 3: the facts. Pure code, no AI.
 *
 * Given the day's StrikeMarkets read from the chain, decide what an on-call operator needs to know at a checkpoint:
 *   create (by 08:00 ET): every expected symbol has a market expiring at today's close, each with a Phoenix book;
 *   settle (after 16:05 ET): every one of those markets is settled, with its close price and outcome.
 * Anything wrong becomes an `issue`. The AI summary may only restate what is in here (see summarize.ts).
 */

export type Checkpoint = "create" | "settle";
export type MarketState = "open" | "settling" | "settled-yes" | "settled-no" | "void";

/** One StrikeMarket as read from the chain (already decoded; no BN / PublicKey types). */
export interface ChainMarket {
  market: string;
  symbol: string;
  strikeE6: bigint;
  expiryTs: number;
  status: number;
  hasBook: boolean;
  settlementPriceE6: bigint;
}

export interface MarketFact {
  symbol: string;
  market: string;
  strike: number;
  state: MarketState;
  hasBook: boolean;
  closePrice: number | null;
}

export interface CopilotFacts {
  checkpoint: Checkpoint;
  dateKey: string;
  closeTs: number;
  markets: MarketFact[];
  counts: { expected: number; created: number; withBook: number; settledYes: number; settledNo: number; unsettled: number };
  issues: string[];
  ok: boolean;
}

/** Matches MarketStatus in solana/instructions.ts. */
const STATE: Record<number, MarketState> = { 0: "open", 1: "settling", 2: "settled-yes", 3: "settled-no", 4: "void" };

/** Settle normally lands within ~1 min of the close; past this the settle checkpoint calls it late. */
export const SETTLE_GRACE_SECS = 300;

const e6 = (v: bigint) => Number(v) / 1e6;

export function buildFacts(o: {
  checkpoint: Checkpoint;
  dateKey: string;
  closeTs: number;
  nowSec: number;
  expectedSymbols: string[];
  chain: ChainMarket[];
}): CopilotFacts {
  // Today's markets only: test markets with other expiries (e.g. a 5-min rehearsal) are not part of the day.
  const today = o.chain.filter((m) => m.expiryTs === o.closeTs);
  const markets: MarketFact[] = today
    .map((m) => {
      const state = STATE[m.status] ?? "open";
      const settled = state === "settled-yes" || state === "settled-no";
      return {
        symbol: m.symbol,
        market: m.market,
        strike: e6(m.strikeE6),
        state,
        hasBook: m.hasBook,
        closePrice: settled ? e6(m.settlementPriceE6) : null,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const issues: string[] = [];
  for (const sym of o.expectedSymbols) {
    const mine = markets.filter((m) => m.symbol === sym);
    if (mine.length === 0) issues.push(`${sym}: no market for ${o.dateKey}`);
    if (mine.length > 1) issues.push(`${sym}: ${mine.length} markets for ${o.dateKey} (expected 1)`);
    for (const m of mine) if (!m.hasBook) issues.push(`${sym}: market has no order book`);
  }

  if (o.checkpoint === "settle") {
    const late = o.nowSec >= o.closeTs + SETTLE_GRACE_SECS;
    if (!late) issues.push(`settle check ran before 16:05 ET; results may still be landing`);
    for (const m of markets) {
      if (m.state === "void") issues.push(`${m.symbol}: market is void`);
      else if (m.closePrice === null && late) issues.push(`${m.symbol}: not settled 5 min after the close`);
    }
  }

  const settledYes = markets.filter((m) => m.state === "settled-yes").length;
  const settledNo = markets.filter((m) => m.state === "settled-no").length;
  return {
    checkpoint: o.checkpoint,
    dateKey: o.dateKey,
    closeTs: o.closeTs,
    markets,
    counts: {
      expected: o.expectedSymbols.length,
      created: markets.length,
      withBook: markets.filter((m) => m.hasBook).length,
      settledYes,
      settledNo,
      unsettled: markets.length - settledYes - settledNo,
    },
    issues,
    ok: issues.length === 0,
  };
}
