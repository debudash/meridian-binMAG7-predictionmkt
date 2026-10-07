/**
 * Client-side Pyth quality awareness (mirrors on-chain settle checks at a high level).
 * On-chain settle remains authoritative; this helps automation decide whether to retry.
 */
export interface PythPriceSample {
  price: bigint;
  conf: bigint;
  expo: number;
  publishSlot: bigint;
  /** Current slot used for staleness. */
  slotNow: bigint;
}

export interface PythQualityConfig {
  maxStalenessSlots: bigint;
  maxConfRatioBps: number;
}

export type PythQualityResult =
  | { ok: true; priceE6: bigint }
  | { ok: false; reason: string };

/** Convert Pyth price+expo → e6 (SCHEMA / units). Rejects non-positive / truncate-to-zero. */
export function pythPriceToE6(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new Error("InvalidPythPrice");
  const shift = expo + 6;
  const e6 = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  if (e6 === 0n) throw new Error("InvalidPythPrice");
  return e6;
}

export function checkPythQuality(
  sample: PythPriceSample,
  cfg: PythQualityConfig
): PythQualityResult {
  if (sample.slotNow > sample.publishSlot) {
    const age = sample.slotNow - sample.publishSlot;
    if (age > cfg.maxStalenessSlots) {
      return { ok: false, reason: `stale: age=${age} > max=${cfg.maxStalenessSlots}` };
    }
  }
  try {
    const priceE6 = pythPriceToE6(sample.price, sample.expo);
    if (sample.price > 0n && sample.conf > 0n) {
      // conf / |price| in bps ≈ conf * 10000 / price
      const ratioBps = Number((sample.conf * 10000n) / sample.price);
      if (ratioBps > cfg.maxConfRatioBps) {
        return {
          ok: false,
          reason: `wide conf: ratioBps=${ratioBps} > max=${cfg.maxConfRatioBps}`,
        };
      }
    }
    return { ok: true, priceE6 };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
