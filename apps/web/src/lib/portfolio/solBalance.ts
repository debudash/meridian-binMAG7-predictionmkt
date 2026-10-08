/**
 * Portfolio "SOL (network fees)" tile (docs/ui/04: "See available USDC/SOL"). SOL only pays transaction fees here;
 * collateral is USDC. Low = under what a few trades need, matching the docs/ui/07 "No SOL" state.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** 0.005 SOL ≈ a handful of trades with priority fees and one-time seat / token-account rent. */
export const LOW_SOL_LAMPORTS = 5_000_000;

export function formatSol(lamports: number | null): string {
  return lamports == null ? "—" : `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}

export function solIsLow(lamports: number | null): boolean {
  return lamports != null && lamports < LOW_SOL_LAMPORTS;
}
