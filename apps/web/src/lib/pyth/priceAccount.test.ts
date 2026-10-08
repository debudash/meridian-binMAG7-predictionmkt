import { describe, expect, it } from "vitest";
import {
  decodePythPriceAccount,
  MOCK_PYTH_MAGIC,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  PYTH_LEGACY_MAGIC,
} from "./priceAccount";

function mock(price: bigint, conf: bigint, expo: number, slot: bigint, feedByte = 7): Uint8Array {
  const b = new Uint8Array(64);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, MOCK_PYTH_MAGIC, true);
  dv.setBigInt64(4, price, true);
  dv.setBigUint64(12, conf, true);
  dv.setInt32(20, expo, true);
  dv.setBigUint64(24, slot, true);
  b.fill(feedByte, 32, 64);
  return b;
}

describe("decodePythPriceAccount", () => {
  it("decodes the localnet mock layout (upsert_mock_pyth)", () => {
    const d = decodePythPriceAccount(mock(13_820_000_000n, 5_000_000n, -8, 1234n))!;
    expect(d.source).toBe("mock");
    expect(d.price).toBeCloseTo(138.2, 6);
    expect(d.conf).toBeCloseTo(0.05, 6);
    expect(d.expo).toBe(-8);
    expect(d.publishSlot).toBe(1234);
    expect(d.feedIdHex).toBe("07".repeat(32));
    expect(d.confMantissa).toBe(5_000_000n);
  });

  it("all-zero mock feed id → undefined", () => {
    expect(decodePythPriceAccount(mock(1n * 10n ** 10n, 0n, -8, 1n, 0))!.feedIdHex).toBeUndefined();
  });

  it("decodes legacy Pyth Price offsets", () => {
    const b = new Uint8Array(3312);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, PYTH_LEGACY_MAGIC, true);
    dv.setInt32(20, -5, true);
    dv.setBigInt64(208, 23_012_345n, true);
    dv.setBigUint64(216, 1_000n, true);
    dv.setBigUint64(232, 99n, true);
    const d = decodePythPriceAccount(b)!;
    expect(d.source).toBe("legacy");
    expect(d.price).toBeCloseTo(230.12345, 6);
    expect(d.conf).toBeCloseTo(0.01, 6);
    expect(d.publishSlot).toBe(99);
    expect(d.feedIdHex).toBeUndefined();
  });

  it("decodes Pyth receiver PriceUpdateV2 (Full verification)", () => {
    const b = new Uint8Array(134);
    const dv = new DataView(b.buffer);
    b.set(PRICE_UPDATE_V2_DISCRIMINATOR, 0);
    let o = 8 + 32;
    b[o] = 1; // Full
    o += 1;
    b.fill(0xab, o, o + 32);
    o += 32;
    dv.setBigInt64(o, 41_850_000_000n, true);
    dv.setBigUint64(o + 8, 20_000_000n, true);
    dv.setInt32(o + 16, -8, true);
    dv.setBigInt64(o + 20, 1_791_000_000n, true);
    dv.setBigUint64(o + 20 + 32, 555n, true);
    const d = decodePythPriceAccount(b)!;
    expect(d.source).toBe("receiver");
    expect(d.price).toBeCloseTo(418.5, 6);
    expect(d.conf).toBeCloseTo(0.2, 6);
    expect(d.publishTime).toBe(1_791_000_000);
    expect(d.publishSlot).toBe(555);
    expect(d.feedIdHex).toBe("ab".repeat(32));
  });

  it("rejects unknown/short/non-positive data", () => {
    expect(decodePythPriceAccount(null)).toBeNull();
    expect(decodePythPriceAccount(new Uint8Array(4))).toBeNull();
    expect(decodePythPriceAccount(new Uint8Array(64))).toBeNull();
    expect(decodePythPriceAccount(mock(0n, 0n, -8, 1n))).toBeNull();
    expect(decodePythPriceAccount(mock(-5n, 0n, -8, 1n))).toBeNull();
  });
});
