"use client";

/**
 * Meridian user instructions: mint, merge_pair, redeem.
 * Settle is permissionless/read-status; create_strike is automation (not UI).
 * Buy No = mint + Phoenix ask; Sell No = Phoenix bid + merge_pair (immediate).
 *
 * Account names match idl/meridian.prod.json exactly.
 */
import { BN, type Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { configPda, vaultAuthorityPda } from "./pdas";

export interface MintAccounts {
  user: PublicKey;
  strikeMarket: PublicKey;
  collateralVault: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  treasury: PublicKey;
  collateralMint: PublicKey;
}

/** Same account set as mint — merge_pair is the Open-state inverse. */
export type MergeAccounts = MintAccounts;

/** Mint Yes+No pair against USDC collateral (amount in base units). */
export async function buildMintIx(
  program: Program,
  accounts: MintAccounts,
  amount: BN,
) {
  const [config] = configPda();
  const [vaultAuthority] = vaultAuthorityPda(accounts.strikeMarket);
  const userCollateralAta = getAssociatedTokenAddressSync(
    accounts.collateralMint,
    accounts.user,
  );
  const userYesAta = getAssociatedTokenAddressSync(
    accounts.yesMint,
    accounts.user,
  );
  const userNoAta = getAssociatedTokenAddressSync(
    accounts.noMint,
    accounts.user,
  );

  return (program.methods as any)
    .mint(amount)
    .accounts({
      user: accounts.user,
      config,
      strikeMarket: accounts.strikeMarket,
      collateralVault: accounts.collateralVault,
      vaultAuthority,
      userCollateralAta,
      userYesAta,
      userNoAta,
      yesMint: accounts.yesMint,
      noMint: accounts.noMint,
      treasury: accounts.treasury,
      collateralMint: accounts.collateralMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
}

/**
 * Merge Yes+No → USDC while market Open (D-018 / merge_pair).
 * Amount in outcome raw units (same scale as mint).
 */
export async function buildMergeIx(
  program: Program,
  accounts: MergeAccounts,
  amount: BN,
) {
  const [config] = configPda();
  const [vaultAuthority] = vaultAuthorityPda(accounts.strikeMarket);
  const userCollateralAta = getAssociatedTokenAddressSync(
    accounts.collateralMint,
    accounts.user,
  );
  const userYesAta = getAssociatedTokenAddressSync(
    accounts.yesMint,
    accounts.user,
  );
  const userNoAta = getAssociatedTokenAddressSync(
    accounts.noMint,
    accounts.user,
  );

  return (program.methods as any)
    .mergePair(amount)
    .accounts({
      user: accounts.user,
      config,
      strikeMarket: accounts.strikeMarket,
      collateralVault: accounts.collateralVault,
      vaultAuthority,
      userCollateralAta,
      userYesAta,
      userNoAta,
      yesMint: accounts.yesMint,
      noMint: accounts.noMint,
      treasury: accounts.treasury,
      collateralMint: accounts.collateralMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
}

export interface RedeemAccounts {
  user: PublicKey;
  strikeMarket: PublicKey;
  collateralVault: PublicKey;
  /** Winning side mint (Yes or No after settle) */
  winningMint: PublicKey;
  collateralMint: PublicKey;
  treasury: PublicKey;
}

/** Redeem winning outcome tokens for USDC after settle. */
export async function buildRedeemIx(
  program: Program,
  accounts: RedeemAccounts,
  amount: BN,
) {
  const [config] = configPda();
  const [vaultAuthority] = vaultAuthorityPda(accounts.strikeMarket);
  const userCollateralAta = getAssociatedTokenAddressSync(
    accounts.collateralMint,
    accounts.user,
  );
  const userWinningAta = getAssociatedTokenAddressSync(
    accounts.winningMint,
    accounts.user,
  );

  return (program.methods as any)
    .redeem(amount)
    .accounts({
      user: accounts.user,
      config,
      strikeMarket: accounts.strikeMarket,
      collateralVault: accounts.collateralVault,
      vaultAuthority,
      userCollateralAta,
      userWinningAta,
      winningMint: accounts.winningMint,
      treasury: accounts.treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
}

/**
 * Read-only settle status helper — does not submit settle.
 * Actual settle ix is permissionless / automation-driven.
 */
export function settleStatusLabel(
  status: number,
): "open" | "settling" | "settled-yes" | "settled-no" | "void" {
  switch (status) {
    case 1:
      return "settling";
    case 2:
      return "settled-yes";
    case 3:
      return "settled-no";
    case 4:
      return "void";
    default:
      return "open";
  }
}
