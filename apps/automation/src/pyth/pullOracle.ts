/**
 * Pyth pull oracle helpers (D-025): PriceUpdateV2 decode + the on-chain settle-price rule.
 * Mirrors programs/meridian/src/utils/pyth.rs so automation can decide *before* sending.
 */
import { PublicKey } from "@solana/web3.js";

export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);
/** D-005 staleness slots → publish window seconds (150 slots × 0.4 s = 60 s). */
export const SLOT_MS = 400;

export interface PullPrice {
  feedIdHex: string; // 64 hex chars, no 0x
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  prevPublishTime: number;
}

export interface PriceUpdateV2 extends PullPrice {
  writeAuthority: PublicKey;
  fullyVerified: boolean;
  postedSlot: bigint;
}

export function decodePriceUpdateV2(data: Buffer): PriceUpdateV2 {
  if (data.length < 41 || !data.subarray(0, 8).equals(PRICE_UPDATE_V2_DISCRIMINATOR)) {
    throw new Error("not a PriceUpdateV2 account");
  }
  const tag = data[40];
  if (tag !== 0 && tag !== 1) throw new Error(`bad verification level tag ${tag}`);
  let o = tag === 1 ? 41 : 42;
  if (data.length < o + 92) throw new Error("PriceUpdateV2 truncated");
  const feedIdHex = data.subarray(o, o + 32).toString("hex");
  o += 32;
  return {
    writeAuthority: new PublicKey(data.subarray(8, 40)),
    fullyVerified: tag === 1,
    feedIdHex,
    price: data.readBigInt64LE(o),
    conf: data.readBigUInt64LE(o + 8),
    expo: data.readInt32LE(o + 16),
    publishTime: Number(data.readBigInt64LE(o + 20)),
    prevPublishTime: Number(data.readBigInt64LE(o + 28)),
    postedSlot: data.readBigUInt64LE(o + 52),
  };
}

export function publishWindowSecs(maxStalenessSlots: number | bigint): number {
  return Math.floor((Number(maxStalenessSlots) * SLOT_MS) / 1000);
}

export type RuleResult = { ok: true } | { ok: false; code: string; reason: string };

/**
 * Same checks as on-chain prod settle (minus owner/verification, checked by the caller):
 * feed id match, first price at/after expiry (prev < expiry <= publish), publish <= expiry + window,
 * conf/price <= maxConfBps.
 */
export function checkSettlePrice(
  p: PullPrice,
  opts: { expiryTs: number; feedIdHex: string; windowSecs: number; maxConfBps: number }
): RuleResult {
  if (p.feedIdHex.toLowerCase() !== opts.feedIdHex.replace(/^0x/, "").toLowerCase()) {
    return { ok: false, code: "InvalidPythAccount", reason: `feed id ${p.feedIdHex} != market ${opts.feedIdHex}` };
  }
  if (!(p.publishTime >= opts.expiryTs && p.prevPublishTime < opts.expiryTs)) {
    return {
      ok: false,
      code: "PythPriceNotAtExpiry",
      reason: `need prev_publish_time < ${opts.expiryTs} <= publish_time; got prev=${p.prevPublishTime} publish=${p.publishTime}`,
    };
  }
  if (p.publishTime > opts.expiryTs + opts.windowSecs) {
    return {
      ok: false,
      code: "StalePythPrice",
      reason: `publish_time ${p.publishTime} > expiry ${opts.expiryTs} + ${opts.windowSecs}s (no Pyth update right after expiry; admin_settle fallback)`,
    };
  }
  if (p.price <= 0n) return { ok: false, code: "InvalidPythPrice", reason: "non-positive price" };
  const ratioBps = (p.conf * 10_000n) / p.price;
  if (ratioBps > BigInt(opts.maxConfBps)) {
    return { ok: false, code: "PythConfidenceTooWide", reason: `conf ratio ${ratioBps} bps > ${opts.maxConfBps}` };
  }
  return { ok: true };
}
