/**
 * Client RPC budget (M4, Reviewers !63). Public devnet RPC rate-limits hard, so:
 *  - Phoenix market-state reads (tens–hundreds of KB each) only where they matter: open markets,
 *    plus settled ones on the Portfolio page (seat leftovers to withdraw). Never in the Header.
 *  - The Header redeem dot only reads settled markets' Yes/No ATAs.
 *  - Slower polls everywhere, and exponential backoff on 429.
 * Own-tx actions invalidate the shared caches, so the UI still refreshes immediately after a trade.
 */
import type { AccountMarketRef } from "@/lib/portfolio/readAccount";
import type { MarketView } from "@/lib/market/types";

export const POLL_MS = {
  /** Header redeem dot (every page) — was 30s over all markets incl. Phoenix */
  headerAccount: 60_000,
  /** Portfolio page account read — was 15s */
  portfolioAccount: 30_000,
  /** Markets list / landing exposure — was 10s */
  marketsAccount: 30_000,
  /** Trade page wallet + seat read for one market — was 4s */
  tradeAccount: 10_000,
  /** Trade page Phoenix ladder — was 4s; paused while the tab is hidden */
  tradeBook: 6_000,
  /** History page / trade Fills tab (getSignaturesForAddress + up to 100 parsed txs) — was 30s */
  history: 60_000,
  /** /api/markets from client surfaces — was 30s (server also caches the scan) */
  marketList: 60_000,
} as const;

export const MAX_BACKOFF_MS = 300_000;

export function is429(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|too many requests/i.test(msg);
}

/** Next poll delay: base, doubled per consecutive 429 failure, capped at 5 min. */
export function backoffInterval(baseMs: number, error: unknown, failureCount = 0): number {
  if (!is429(error)) return baseMs;
  return Math.min(MAX_BACKOFF_MS, baseMs * 2 ** Math.max(1, failureCount));
}

/** react-query refetchInterval with 429 backoff. */
export function refetchWithBackoff(baseMs: number) {
  return (query: { state: { error: unknown; fetchFailureCount: number } }) =>
    backoffInterval(baseMs, query.state.error, query.state.fetchFailureCount);
}

type MarketRefInput = Pick<MarketView, "marketId" | "status" | "yesMint" | "noMint" | "phoenixMarket">;

export type AccountScope = "default" | "portfolio" | "redeemable";

/**
 * Which markets (and which Phoenix books) an account read covers.
 *  - default: every market's ATAs; Phoenix only for open markets
 *  - portfolio: also settled/settling markets' Phoenix seats (withdraw leftovers); not void
 *  - redeemable: settled markets' ATAs only, no Phoenix (Header redeem dot)
 */
export function accountRefsFor(
  markets: readonly MarketRefInput[],
  opts: { scope?: AccountScope } = {},
): AccountMarketRef[] {
  const scope = opts.scope ?? "default";
  const settled = (s: MarketRefInput["status"]) => s === "settled-yes" || s === "settled-no";
  const list = scope === "redeemable" ? markets.filter((m) => settled(m.status)) : markets;
  return list.map((m) => {
    const phoenix =
      scope === "redeemable"
        ? false
        : scope === "portfolio"
          ? m.status !== "void"
          : m.status === "open";
    return {
      marketId: m.marketId,
      yesMint: m.yesMint,
      noMint: m.noMint,
      phoenixMarket: phoenix ? m.phoenixMarket : undefined,
    };
  });
}
