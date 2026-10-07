/**
 * Thin wrappers around Meridian prod instructions used by automation.
 */
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { StrikeSpec } from "../strikes";
import { configPda, deriveStrikeMarket, marketPdas } from "./pdas";

export const MarketStatus = {
  Open: 0,
  Settling: 1,
  SettledYes: 2,
  SettledNo: 3,
  Void: 4,
} as const;

export async function createStrikeMarket(opts: {
  program: Program;
  authority: Keypair;
  collateralMint: PublicKey;
  pythPriceFeed: PublicKey;
  strike: StrikeSpec;
}): Promise<{ market: PublicKey; signature: string }> {
  const programId = opts.program.programId;
  const [config] = configPda(programId);
  const market = deriveStrikeMarket(
    programId,
    opts.strike.equitySymbol,
    opts.strike.expiryTs,
    opts.strike.strikePriceE6
  );
  const { yesMint, noMint, vaultAuthority, collateralVault } = marketPdas(programId, market);

  const signature = await (opts.program.methods as any)
    .createStrikeMarket({
      equitySymbol: Array.from(opts.strike.equitySymbol),
      strikePriceE6: opts.strike.strikePriceE6,
      expiryTs: opts.strike.expiryTs,
      pythFeedId: Array.from(opts.strike.pythFeedId),
      phoenixMarket: opts.strike.phoenixMarket,
    })
    .accounts({
      authority: opts.authority.publicKey,
      config,
      strikeMarket: market,
      yesMint,
      noMint,
      vaultAuthority,
      collateralVault,
      collateralMint: opts.collateralMint,
      pythPriceFeed: opts.pythPriceFeed,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([opts.authority])
    .rpc();

  return { market, signature };
}

export async function setPhoenixMarket(opts: {
  program: Program;
  authority: Keypair;
  market: PublicKey;
  phoenixMarket: PublicKey;
}): Promise<string> {
  const [config] = configPda(opts.program.programId);
  return await (opts.program.methods as any)
    .setPhoenixMarket(opts.phoenixMarket)
    .accounts({
      authority: opts.authority.publicKey,
      config,
      strikeMarket: opts.market,
    })
    .signers([opts.authority])
    .rpc();
}

export async function settleMarket(opts: {
  program: Program;
  settler: Keypair;
  market: PublicKey;
  pythPriceFeed: PublicKey;
}): Promise<string> {
  const [config] = configPda(opts.program.programId);
  return await (opts.program.methods as any)
    .settle()
    .accounts({
      settler: opts.settler.publicKey,
      config,
      strikeMarket: opts.market,
      pythPriceFeed: opts.pythPriceFeed,
    })
    .signers([opts.settler])
    .rpc();
}

export async function adminSettleMarket(opts: {
  program: Program;
  authority: Keypair;
  market: PublicKey;
  settlementPriceE6: BN;
  outcomeYes: boolean;
}): Promise<string> {
  const [config] = configPda(opts.program.programId);
  return await (opts.program.methods as any)
    .adminSettle(opts.settlementPriceE6, opts.outcomeYes)
    .accounts({
      authority: opts.authority.publicKey,
      config,
      strikeMarket: opts.market,
    })
    .signers([opts.authority])
    .rpc();
}

export async function fetchOpenMarkets(program: Program): Promise<
  Array<{ publicKey: PublicKey; account: any }>
> {
  const all = await (program.account as any).strikeMarket.all();
  return all.filter((m: any) => m.account.status === MarketStatus.Open);
}
