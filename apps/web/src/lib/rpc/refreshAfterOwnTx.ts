/**
 * DLV-114: refresh the shared wallet caches after one of this wallet's own transactions, so the trade
 * page's Position and Fills (and History / Portfolio) update without a reload.
 *
 * Root cause of "Fills row only after a reload": TradeTicket never invalidated anything after a confirmed
 * trade. Position caught up through its own 10 s account poll, but the history query behind the Fills tab
 * polls only every 60 s while that tab is open (never otherwise, M4 RPC budget) and is fresh for 30 s, so
 * the new fill waited for a reload. And `getSignaturesForAddress` can lag the confirmation by a moment, so
 * one refetch right after confirm can still miss the tx: refetch the history on a short bounded schedule
 * until the signature shows up in the rows (or the schedule ends).
 */
import type { QueryClient } from "@tanstack/react-query";

export const WALLET_ACCOUNT_KEY = "wallet-account";
export const WALLET_HISTORY_KEY = "wallet-history";

/** Waits before each history refetch: immediately, then backing off; ~17.5 s total, 5 RPC scans max. */
export const HISTORY_RETRY_DELAYS_MS: readonly number[] = [0, 1_500, 3_000, 5_000, 8_000];

/** Fills tab: refetch on open when the cached history is older than this. */
export const FILLS_OPEN_MAX_AGE_MS = 10_000;

type QueryClientLike = Pick<QueryClient, "invalidateQueries" | "refetchQueries" | "getQueriesData">;

export function historyHasSig(data: unknown, sig: string): boolean {
  const rows = (data as { rows?: Array<{ sig?: string }> } | undefined)?.rows;
  return Array.isArray(rows) && rows.some((r) => r?.sig === sig);
}

export async function refreshAfterOwnTx(
  qc: QueryClientLike,
  signature: string,
  opts: { sleep?: (ms: number) => Promise<void>; delaysMs?: readonly number[] } = {},
): Promise<{ historyAttempts: number; historyFound: boolean }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = opts.delaysMs ?? HISTORY_RETRY_DELAYS_MS;
  // Balances / seat / orders: refetch now (active queries), mark the rest stale.
  void qc.invalidateQueries({ queryKey: [WALLET_ACCOUNT_KEY] });
  // History pages not mounted right now refetch on their next mount.
  await qc.invalidateQueries({ queryKey: [WALLET_HISTORY_KEY], refetchType: "none" });
  const found = () => qc.getQueriesData({ queryKey: [WALLET_HISTORY_KEY] }).some(([, d]) => historyHasSig(d, signature));
  if (qc.getQueriesData({ queryKey: [WALLET_HISTORY_KEY] }).length === 0) return { historyAttempts: 0, historyFound: false };
  let attempts = 0;
  for (const d of delays) {
    if (d > 0) await sleep(d);
    attempts++;
    await qc.refetchQueries({ queryKey: [WALLET_HISTORY_KEY], type: "active" });
    if (found()) return { historyAttempts: attempts, historyFound: true };
  }
  return { historyAttempts: attempts, historyFound: false };
}

export function shouldRefetchOnFillsOpen(dataUpdatedAt: number, nowMs: number, maxAgeMs = FILLS_OPEN_MAX_AGE_MS): boolean {
  return nowMs - dataUpdatedAt > maxAgeMs;
}
