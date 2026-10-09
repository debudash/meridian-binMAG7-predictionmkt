/**
 * Operator copilot, step 1 of 3: the facts. Pure code, no AI.
 *
 * Given the day's StrikeMarkets read from the chain, decide what an on-call operator needs to know at a checkpoint:
 *   create (by 08:00 ET): every expected symbol has `perSymbol` markets expiring at today's close, each with a book;
 *   settle (after 16:05 ET): every one of those markets is settled, with its close price and outcome.
 * Anything wrong becomes an `issue`. Code writes every status and market line; the AI only adds a headline.
 */

export type Checkpoint = "create" | "settle";
export type MarketState = "open" | "settling" | "settled-yes" | "settled-no" | "void" | "unknown";

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
/** The create deadline is 08:00 ET, 8 h before the 16:00 close (D-026). */
export const CREATE_DEADLINE_BEFORE_CLOSE_SECS = 8 * 3600;

const SYSTEM_PROGRAM = "11111111111111111111111111111111"; // PublicKey.default: no Phoenix book bound
const e6 = (v: bigint) => Number(v) / 1e6;

/** Anchor-decoded StrikeMarket account → ChainMarket. Structural types so it is testable without RPC. */
export function fromAnchorAccount(a: {
  publicKey: { toBase58(): string };
  account: {
    equitySymbol: ArrayLike<number>;
    strikePriceE6: { toString(): string };
    expiryTs: { toString(): string };
    status: number;
    phoenixMarket: { toBase58(): string };
    settlementPriceE6: { toString(): string };
  };
}): ChainMarket {
  return {
    market: a.publicKey.toBase58(),
    symbol: Buffer.from(Array.from(a.account.equitySymbol)).toString("utf8").replace(/\0/g, "").trim(),
    strikeE6: BigInt(a.account.strikePriceE6.toString()),
    expiryTs: Number(a.account.expiryTs.toString()),
    status: Number(a.account.status),
    hasBook: a.account.phoenixMarket.toBase58() !== SYSTEM_PROGRAM,
    settlementPriceE6: BigInt(a.account.settlementPriceE6.toString()),
  };
}

export function buildFacts(o: {
  checkpoint: Checkpoint;
  dateKey: string;
  closeTs: number;
  nowSec: number;
  expectedSymbols: string[];
  /** Strikes per symbol per day: the worker's STRIKE_OFFSETS_E6 length (3 by default; 1 for the ops bootstrap). */
  perSymbol: number;
  chain: ChainMarket[];
}): CopilotFacts {
  const expected = new Set(o.expectedSymbols);
  const issues: string[] = [];
  // Today's markets only: test markets with other expiries (e.g. a 5-min rehearsal) are not part of the day.
  const today = o.chain.filter((m) => m.expiryTs === o.closeTs);
  for (const m of today) if (!expected.has(m.symbol)) issues.push(`${m.symbol}: unexpected market for ${o.dateKey} (not in STRIKE_SYMBOLS)`);

  const markets: MarketFact[] = today
    .filter((m) => expected.has(m.symbol))
    .map((m) => {
      const state = STATE[m.status] ?? "unknown";
      const settled = state === "settled-yes" || state === "settled-no";
      return { symbol: m.symbol, market: m.market, strike: e6(m.strikeE6), state, hasBook: m.hasBook, closePrice: settled ? e6(m.settlementPriceE6) : null };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strike - b.strike);

  if (o.checkpoint === "create" && o.nowSec < o.closeTs - CREATE_DEADLINE_BEFORE_CLOSE_SECS)
    issues.push(`create check ran before 08:00 ET; markets may still be coming`);
  for (const sym of o.expectedSymbols) {
    const n = markets.filter((m) => m.symbol === sym).length;
    if (n === 0) issues.push(`${sym}: no market for ${o.dateKey}`);
    else if (n !== o.perSymbol) issues.push(`${sym}: ${n} markets for ${o.dateKey} (expected ${o.perSymbol})`);
  }
  for (const m of markets) {
    if (!m.hasBook) issues.push(`${m.symbol} ≥ $${m.strike.toFixed(2)}: no order book`);
    if (m.state === "unknown") issues.push(`${m.symbol} ≥ $${m.strike.toFixed(2)}: unknown on-chain status`);
  }

  if (o.checkpoint === "settle") {
    const late = o.nowSec >= o.closeTs + SETTLE_GRACE_SECS;
    if (!late) issues.push(`settle check ran before 16:05 ET; results may still be landing`);
    for (const m of markets) {
      if (m.state === "void") issues.push(`${m.symbol} ≥ $${m.strike.toFixed(2)}: market is void`);
      else if (m.closePrice === null && late) issues.push(`${m.symbol} ≥ $${m.strike.toFixed(2)}: not settled 5 min after the close`);
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
      expected: o.expectedSymbols.length * o.perSymbol,
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
