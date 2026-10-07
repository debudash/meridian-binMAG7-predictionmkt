import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { strikeMarketSeeds } from "../strikes";

export function configPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
}

export function marketPdas(programId: PublicKey, market: PublicKey) {
  const [yesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("yes_mint"), market.toBuffer()],
    programId
  );
  const [noMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("no_mint"), market.toBuffer()],
    programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), market.toBuffer()],
    programId
  );
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault"), market.toBuffer()],
    programId
  );
  return { yesMint, noMint, vaultAuthority, collateralVault };
}

export function deriveStrikeMarket(
  programId: PublicKey,
  equitySymbol: Buffer,
  expiryTs: BN,
  strikePriceE6: BN
): PublicKey {
  return strikeMarketSeeds(programId, equitySymbol, expiryTs, strikePriceE6)[0];
}
