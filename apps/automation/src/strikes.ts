/**
 * Strike arg encoding helpers (SCHEMA §5.2 CreateStrikeParams).
 * Strike formula is a placeholder: priorClose ± offsets (extension point for real prior-close).
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/** Space-pad / truncate equity symbol to exactly 8 bytes. */
export function encodeEquitySymbol(symbol: string): Buffer {
  const upper = symbol.trim().toUpperCase();
  const buf = Buffer.alloc(8, 0x20); // spaces
  Buffer.from(upper, "utf8").copy(buf, 0, 0, Math.min(8, upper.length));
  return buf;
}

export function decodeEquitySymbol(buf: Buffer | number[] | Uint8Array): string {
  return Buffer.from(buf).toString("utf8").replace(/\0/g, "").trim();
}

export interface StrikeSpec {
  symbol: string;
  equitySymbol: Buffer;
  strikePriceE6: BN;
  expiryTs: BN;
  pythFeedId: Buffer;
  phoenixMarket: PublicKey;
}

/**
 * Build strike list from prior-close placeholder + offsets.
 * Extension point: swap `priorCloseE6` source for a real OHLC feed.
 */
export function buildStrikes(opts: {
  symbols: string[];
  priorCloseE6: bigint;
  offsetsE6: number[];
  expiryTs: number;
  feedIds?: Record<string, Buffer>;
  phoenixMarkets?: Record<string, PublicKey>;
}): StrikeSpec[] {
  const out: StrikeSpec[] = [];
  const zeroPk = PublicKey.default;
  for (const symbol of opts.symbols) {
    const key = symbol.toUpperCase();
    const feedId = opts.feedIds?.[key] ?? Buffer.alloc(32, 0);
    if (feedId.length !== 32) throw new Error(`pyth_feed_id for ${key} must be 32 bytes`);
    const phoenix = opts.phoenixMarkets?.[key] ?? zeroPk;
    for (const off of opts.offsetsE6) {
      const strike = opts.priorCloseE6 + BigInt(off);
      if (strike <= 0n) {
        throw new Error(`strike_price_e6 must be > 0 (symbol=${key} offset=${off})`);
      }
      out.push({
        symbol: key,
        equitySymbol: encodeEquitySymbol(key),
        strikePriceE6: new BN(strike.toString()),
        expiryTs: new BN(opts.expiryTs),
        pythFeedId: feedId,
        phoenixMarket: phoenix,
      });
    }
  }
  return out;
}

/** PDA seeds for strike_market (must match program). */
export function strikeMarketSeeds(
  programId: PublicKey,
  equitySymbol: Buffer,
  expiryTs: BN,
  strikePriceE6: BN
): [PublicKey, number] {
  const expiryBuf = Buffer.alloc(8);
  expiryBuf.writeBigInt64LE(BigInt(expiryTs.toString()));
  const strikeBuf = Buffer.alloc(8);
  strikeBuf.writeBigUInt64LE(BigInt(strikePriceE6.toString()));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strike_market"), equitySymbol, expiryBuf, strikeBuf],
    programId
  );
}
