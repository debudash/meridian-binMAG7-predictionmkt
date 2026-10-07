/**
 * Unified human-contracts → mint raw & Phoenix sizeInBaseUnits.
 *
 * Assumptions (docs/units.md + Reviewer High):
 * - Outcome Yes/No mint decimals == collateral decimals (default 6).
 * - 1 human contract = 1 full outcome token = 10^decimals raw atoms.
 * - Phoenix `sizeInBaseUnits` in @ellipsis-labs/phoenix-sdk *fromTemplate*
 *   helpers is expressed in **raw base units** (whole tokens): the SDK does
 *   `rawBaseUnitsToBaseLotsRoundedDown(size)` = size / rawBaseUnitsPerBaseUnit
 *   × baseLotsPerBaseUnit (market.ts). Passing atoms would oversize by 10^decimals.
 *   So phoenixBaseUnits == contracts, while mintRaw == contracts × 10^decimals.
 */
export const DEFAULT_OUTCOME_DECIMALS = 6;

export interface ContractSizeRaw {
  /** Meridian mint / merge_pair amount (u64-compatible number) */
  mintRaw: number;
  /** Phoenix place sizeInBaseUnits (raw base units = whole contracts) */
  phoenixBaseUnits: number;
  /** Echo of input contracts */
  contracts: number;
  decimals: number;
}

/**
 * Convert UI contract count to Meridian mint/merge raw and Phoenix base atoms.
 * Both legs use the same raw amount so Buy No mint qty matches the Yes ask size.
 */
export function contractsToRawAmounts(
  contracts: number,
  decimals: number = DEFAULT_OUTCOME_DECIMALS,
): ContractSizeRaw {
  if (!Number.isFinite(contracts) || contracts < 0) {
    throw new Error(`contractsToRawAmounts: invalid contracts ${contracts}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`contractsToRawAmounts: invalid decimals ${decimals}`);
  }
  const mintRaw = Math.round(contracts * 10 ** decimals);
  return {
    mintRaw,
    phoenixBaseUnits: contracts,
    contracts,
    decimals,
  };
}
