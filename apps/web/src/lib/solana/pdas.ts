import { PublicKey } from "@solana/web3.js";
import { getProgramId } from "./config";

export function configPda(programId = getProgramId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
}

/**
 * StrikeMarket PDA seeds from prod IDL create_strike_market:
 * ["strike_market", equity_symbol (8 bytes), expiry_ts i64 LE, strike_price_e6 u64 LE]
 */
export function strikeMarketPda(
  equitySymbol: string | Uint8Array,
  expiryTs: number | bigint,
  strikePriceE6: number | bigint,
  programId = getProgramId(),
): [PublicKey, number] {
  const sym = Buffer.alloc(8);
  const raw =
    typeof equitySymbol === "string"
      ? Buffer.from(equitySymbol)
      : Buffer.from(equitySymbol);
  raw.copy(sym, 0, 0, Math.min(8, raw.length));

  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(BigInt(expiryTs));

  const strike = Buffer.alloc(8);
  strike.writeBigUInt64LE(BigInt(strikePriceE6));

  return PublicKey.findProgramAddressSync(
    [Buffer.from("strike_market"), sym, expiry, strike],
    programId,
  );
}

export function vaultAuthorityPda(
  strikeMarket: PublicKey,
  programId = getProgramId(),
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), strikeMarket.toBuffer()],
    programId,
  );
}
