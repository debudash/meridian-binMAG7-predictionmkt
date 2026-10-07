"use client";

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { MERIDIAN_IDL } from "./idl";
import { getProgramId, getRpcUrl } from "./config";

export type MeridianProgram = Program;

/** Read-only connection (SSR / no wallet). */
export function getConnection(rpcUrl = getRpcUrl()): Connection {
  return new Connection(rpcUrl, "confirmed");
}

/**
 * Build Anchor Program from prod IDL.
 * Wallet adapter provider must be passed for signing (mint/redeem).
 */
export function getMeridianProgram(
  provider: AnchorProvider,
  programId = getProgramId(),
): Program {
  // Anchor 0.31 accepts IDL + provider; program address from IDL or override
  const idl = {
    ...MERIDIAN_IDL,
    address: programId.toBase58(),
  };
  return new Program(idl as typeof MERIDIAN_IDL, provider);
}

export function walletProvider(
  connection: Connection,
  wallet: AnchorProvider["wallet"],
): AnchorProvider {
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

/** Fetch StrikeMarket account if pubkey known. Stub indexer otherwise. */
export async function fetchStrikeMarket(
  program: Program,
  strikeMarket: PublicKey,
): Promise<unknown | null> {
  try {
    const acc = await (program.account as any).strikeMarket.fetch(strikeMarket);
    return acc;
  } catch {
    return null;
  }
}

export async function fetchConfig(
  program: Program,
  config: PublicKey,
): Promise<{ paused: boolean } | null> {
  try {
    const acc = await (program.account as any).config.fetch(config);
    return { paused: Boolean(acc.paused) };
  } catch {
    return null;
  }
}
