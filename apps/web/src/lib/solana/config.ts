/**
 * Public env config for Meridian web.
 * Matches docs/DEPLOY.md §4 NEXT_PUBLIC_* (no secrets).
 */
import { PublicKey } from "@solana/web3.js";

export const DEFAULT_PROGRAM_ID =
  "GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2";

export function getCluster(): string {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
}

export function getRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}

export function getProgramId(): PublicKey {
  const id =
    process.env.NEXT_PUBLIC_MERIDIAN_PROGRAM_ID ?? DEFAULT_PROGRAM_ID;
  return new PublicKey(id);
}

export function getUsdcMint(): PublicKey | null {
  const m = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!m) return null;
  try {
    return new PublicKey(m);
  } catch {
    return null;
  }
}

export function getIndexerUrl(): string | null {
  return process.env.NEXT_PUBLIC_INDEXER_URL || null;
}

export function getExplorerUrl(): string {
  return process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.solana.com";
}

export function explorerTx(sig: string): string {
  const base = getExplorerUrl();
  const cluster = getCluster();
  const q = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `${base}/tx/${sig}${q}`;
}
