/**
 * Decode the underlying price from the account a StrikeMarket points at
 * (`StrikeMarket.pyth_price_feed`). Pure — no RPC. Three layouts:
 *
 * - **mock**  Meridian localnet mock (`upsert_mock_pyth`, magic 0x5459504d) — the same
 *   source automation sim + settle read on localnet:
 *   magic:u32 | price:i64 | conf:u64 | expo:i32 | publish_slot:u64 | feed_id:[u8;32]
 * - **legacy** Pyth legacy `Price` account (magic 0xa1b2c3d4): expo@20, agg.price@208,
 *   agg.conf@216, agg.pub_slot@232 (offsets match programs/meridian/src/utils/pyth.rs).
 * - **receiver** Pyth Solana Receiver `PriceUpdateV2` (D-019 shard-0 accounts): Anchor
 *   discriminator, write_authority, verification_level, PriceFeedMessage, posted_slot.
 *
 * Anything else → null (UI shows "—").
 */

export const MOCK_PYTH_MAGIC = 0x5459504d;
export const PYTH_LEGACY_MAGIC = 0xa1b2c3d4;
/** sha256("account:PriceUpdateV2")[0..8] */
export const PRICE_UPDATE_V2_DISCRIMINATOR = [34, 241, 35, 99, 157, 126, 244, 205];

export type PythPriceSource = "mock" | "legacy" | "receiver";

export interface DecodedPythPrice {
  source: PythPriceSource;
  /** Human price (mantissa × 10^expo) */
  price: number;
  /** Human confidence (same scale as price) */
  conf: number;
  expo: number;
  /** Raw mantissa — settle events carry conf in these units */
  priceMantissa: bigint;
  confMantissa: bigint;
  /** Slot the price was published / posted (mock + legacy + receiver) */
  publishSlot?: number;
  /** Unix seconds (receiver only — mock/legacy carry slots, not times) */
  publishTime?: number;
  /** 32-byte feed id hex (mock + receiver); undefined for legacy or all-zero */
  feedIdHex?: string;
}

function toU8(data: Uint8Array | ArrayLike<number>): Uint8Array {
  return data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
}

function hexOrUndefined(bytes: Uint8Array): string | undefined {
  if (bytes.every((b) => b === 0)) return undefined;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function scale(mantissa: bigint, expo: number): number {
  return Number(mantissa) * Math.pow(10, expo);
}

export function decodePythPriceAccount(
  raw: Uint8Array | ArrayLike<number> | null | undefined,
): DecodedPythPrice | null {
  if (!raw) return null;
  const data = toU8(raw);
  if (data.length < 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = dv.getUint32(0, true);

  if (magic === MOCK_PYTH_MAGIC && data.length >= 64) {
    const price = dv.getBigInt64(4, true);
    const conf = dv.getBigUint64(12, true);
    const expo = dv.getInt32(20, true);
    const publishSlot = Number(dv.getBigUint64(24, true));
    if (price <= 0n) return null;
    return {
      source: "mock",
      price: scale(price, expo),
      conf: scale(conf, expo),
      expo,
      priceMantissa: price,
      confMantissa: conf,
      publishSlot,
      feedIdHex: hexOrUndefined(data.subarray(32, 64)),
    };
  }

  if (magic === PYTH_LEGACY_MAGIC && data.length >= 240) {
    const expo = dv.getInt32(20, true);
    const price = dv.getBigInt64(208, true);
    const conf = dv.getBigUint64(216, true);
    const publishSlot = Number(dv.getBigUint64(232, true));
    if (price <= 0n) return null;
    return {
      source: "legacy",
      price: scale(price, expo),
      conf: scale(conf, expo),
      expo,
      priceMantissa: price,
      confMantissa: conf,
      publishSlot,
    };
  }

  if (PRICE_UPDATE_V2_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    // 8 disc + 32 write_authority, then VerificationLevel enum:
    // 0 = Partial { num_signatures: u8 } (2 bytes), 1 = Full (1 byte).
    let o = 8 + 32;
    const level = data[o];
    if (level === 0) o += 2;
    else if (level === 1) o += 1;
    else return null;
    if (data.length < o + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8) return null;
    const feedId = data.subarray(o, o + 32);
    o += 32;
    const price = dv.getBigInt64(o, true);
    const conf = dv.getBigUint64(o + 8, true);
    const expo = dv.getInt32(o + 16, true);
    const publishTime = Number(dv.getBigInt64(o + 20, true));
    // prev_publish_time i64, ema_price i64, ema_conf u64, then posted_slot u64
    const postedSlotOff = o + 20 + 8 + 8 + 8 + 8;
    const publishSlot =
      data.length >= postedSlotOff + 8 ? Number(dv.getBigUint64(postedSlotOff, true)) : undefined;
    if (price <= 0n) return null;
    return {
      source: "receiver",
      price: scale(price, expo),
      conf: scale(conf, expo),
      expo,
      priceMantissa: price,
      confMantissa: conf,
      publishSlot,
      publishTime,
      feedIdHex: hexOrUndefined(feedId),
    };
  }

  return null;
}

export function pythSourceLabel(source: PythPriceSource): string {
  switch (source) {
    case "mock":
      return "mock Pyth (localnet)";
    case "legacy":
      return "Pyth";
    case "receiver":
      return "Pyth";
  }
}
