/**
 * Phoenix enablement gates — DEPLOY.md §4 / SPEC §3.4.
 * Dev/fixture fallback when unset or explicitly disabled.
 */

export function isPhoenixExplicitlyDisabled(): boolean {
  const v = process.env.NEXT_PUBLIC_PHOENIX_ENABLED;
  return v === "false" || v === "0";
}

export function isPhoenixExplicitlyEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_PHOENIX_ENABLED;
  return v === "true" || v === "1";
}

/** Valid base58-ish market pubkey (not fixture "unset"). */
export function hasPhoenixMarketPubkey(phoenixMarket?: string | null): boolean {
  if (!phoenixMarket) return false;
  const m = phoenixMarket.trim();
  if (!m || m === "unset" || m.startsWith("fixture")) return false;
  return m.length >= 32 && m.length <= 44;
}

/**
 * Placement is live when market pubkey is set and not explicitly disabled.
 * Explicit `NEXT_PUBLIC_PHOENIX_ENABLED=true` still requires a market pubkey.
 */
export function isPhoenixPlacementEnabled(phoenixMarket?: string | null): boolean {
  if (isPhoenixExplicitlyDisabled()) return false;
  return hasPhoenixMarketPubkey(phoenixMarket);
}

export function getPhoenixProgramId(): string {
  return (
    process.env.NEXT_PUBLIC_PHOENIX_PROGRAM_ID ??
    "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY"
  );
}

export const PHOENIX_NOT_CONFIGURED_MESSAGE =
  "Phoenix market not configured. Set NEXT_PUBLIC_PHOENIX_ENABLED and a market pubkey (or leave ENABLED unset with phoenixMarket on the strike).";

/**
 * Resting Sell No only: bid is submitted; merge_pair-on-fill is phased.
 * Immediate (market) Sell No packs merge_pair in the same tx — no this caveat.
 */
export const SELL_NO_MERGE_CAVEAT =
  "Sell No resting orders place Bid Yes at 1−p_no only. merge_pair on fill is not automatic yet — after fills, merge Yes+No→USDC via Meridian, or use Market for immediate bid+merge_pair.";
