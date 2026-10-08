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
 * @deprecated Not lot-aware: Phoenix floors to whole lots, so a fractional size here makes the
 * mint and the order disagree (M1). Placement uses contractsToLots on the loaded market.
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

/**
 * M1 (Reviewers, !54): Phoenix floors `sizeInBaseUnits` to whole base lots, and fill-or-kill is
 * enforced on that floored count. Any size that isn't a whole number of lots therefore made the
 * mint (exact amount) and the Phoenix leg (rounded down) disagree, e.g. Buy No 2.5 → 0.5 Yes left
 * over. Sizes are refused before signing unless they are a positive whole multiple of the lot.
 */
export class SizeNotLotAlignedError extends Error {
  readonly reason = "invalid-size" as const;
  constructor(message: string) {
    super(message);
    this.name = "SizeNotLotAlignedError";
  }
}

/** Relative tolerance for "is a whole number of lots" (absorbs float noise like 0.29 / 0.01). */
const LOT_EPSILON = 1e-9;

function wholeLots(x: number): number | null {
  const n = Math.round(x);
  return Math.abs(x - n) <= LOT_EPSILON * Math.max(1, Math.abs(x)) ? n : null;
}

function fmtLot(lotSize: number): string {
  return Number.isInteger(lotSize) ? String(lotSize) : String(Number(lotSize.toPrecision(12)));
}

/**
 * Ticket / client pre-sign check. `lotSize` is in contracts (MarketView.lotSize, default 1).
 * Returns user-facing copy, or null when the size is a positive whole multiple of the lot.
 */
export function lotSizeError(contracts: number, lotSize = 1): string | null {
  if (!Number.isFinite(lotSize) || lotSize <= 0) return "This market's lot size is invalid.";
  if (!Number.isFinite(contracts) || contracts <= 0) return "Enter a size greater than 0.";
  const lots = wholeLots(contracts / lotSize);
  if (lots == null || lots < 1) {
    return lotSize === 1
      ? "Size must be a whole number of contracts."
      : `Size must be a whole multiple of ${fmtLot(lotSize)} contracts.`;
  }
  return null;
}

/** Phoenix MarketMetadata fields that define base lots (@ellipsis-labs/phoenix-sdk). */
export interface PhoenixLotParams {
  /** Raw base atoms per base lot */
  baseLotSize: number;
  baseLotsPerBaseUnit: number;
  rawBaseUnitsPerBaseUnit: number;
}

export interface LotSizing {
  /** Integer base-lot count both legs use */
  numBaseLots: number;
  /** Meridian mint / merge_pair amount = numBaseLots × baseLotSize */
  mintRaw: number;
  /** Phoenix *fromTemplate* `sizeInBaseUnits` that the SDK floors to exactly numBaseLots */
  phoenixBaseUnits: number;
  contracts: number;
}

/** Same arithmetic as the SDK's rawBaseUnitsToBaseLotsRoundedDown. */
function sdkFloorLots(sizeInBaseUnits: number, m: PhoenixLotParams): number {
  return Math.floor((sizeInBaseUnits / m.rawBaseUnitsPerBaseUnit) * m.baseLotsPerBaseUnit);
}

/**
 * Authoritative sizing from the loaded Phoenix market: derive one integer lot count, then the mint
 * raw amount and the Phoenix size from it. Throws SizeNotLotAlignedError for sizes that aren't a
 * positive whole number of lots, or when the market's lot units don't match the outcome decimals.
 */
export function contractsToLots(
  contracts: number,
  m: PhoenixLotParams,
  decimals: number = DEFAULT_OUTCOME_DECIMALS,
): LotSizing {
  if (!Number.isFinite(contracts) || contracts <= 0) {
    throw new SizeNotLotAlignedError("Enter a size greater than 0.");
  }
  if (!(m.baseLotSize > 0 && m.baseLotsPerBaseUnit > 0 && m.rawBaseUnitsPerBaseUnit > 0)) {
    throw new Error("Phoenix market has invalid lot parameters.");
  }
  // contracts are raw base units (1 contract = 1 whole outcome token), as the SDK expects.
  const lots = wholeLots((contracts / m.rawBaseUnitsPerBaseUnit) * m.baseLotsPerBaseUnit);
  if (lots == null || lots < 1) {
    const lotContracts = m.rawBaseUnitsPerBaseUnit / m.baseLotsPerBaseUnit;
    throw new SizeNotLotAlignedError(
      lotContracts === 1
        ? "Size must be a whole number of contracts."
        : `Size must be a whole multiple of ${fmtLot(lotContracts)} contracts.`,
    );
  }
  const mintRaw = lots * m.baseLotSize;
  const exactRaw = Math.round(contracts * 10 ** decimals);
  if (!Number.isSafeInteger(mintRaw) || mintRaw !== exactRaw) {
    throw new Error(
      `Phoenix lot units don't match the outcome mint (lots × lot size ${mintRaw} ≠ ${exactRaw} raw).`,
    );
  }
  // Half a lot of headroom so the SDK's float floor lands on `lots` (0.29/0.01·… → 28.999… → 28).
  const phoenixBaseUnits = ((lots + 0.5) / m.baseLotsPerBaseUnit) * m.rawBaseUnitsPerBaseUnit;
  if (sdkFloorLots(phoenixBaseUnits, m) !== lots) {
    throw new Error("Phoenix size conversion mismatch.");
  }
  return { numBaseLots: lots, mintRaw, phoenixBaseUnits, contracts };
}
