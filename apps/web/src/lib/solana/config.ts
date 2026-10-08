/**
 * Public env config for Meridian web.
 * Matches docs/DEPLOY.md §5.2 NEXT_PUBLIC_* (no secrets).
 */
import { PublicKey } from "@solana/web3.js";
import { isFixtureCluster } from "@/lib/market/marketIdRoute";

export const DEFAULT_PROGRAM_ID =
  "3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj";

export function getCluster(): string {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
}

/**
 * Fixture (sample) markets / order books are a localnet + local-dev convenience only (DLV-084).
 * Devnet, testnet and mainnet must surface real chain state or a clear error/empty state, and so
 * must a fixture-style label pointed at a non-loopback RPC (M2).
 */
export function fixturesAllowed(
  cluster = getCluster(),
  rpcUrl: string | undefined = process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
): boolean {
  // M2: label (localnet / localhost / custom) AND a loopback RPC.
  return isFixtureCluster(cluster, rpcUrl);
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

/**
 * Explorer cluster query. localnet → `cluster=custom&customUrl=<rpc>` so links open
 * against the local validator (explorer.solana.com reads it from the browser).
 */
export function explorerClusterQuery(
  cluster = getCluster(),
  rpcUrl = getRpcUrl(),
): string {
  if (cluster === "mainnet-beta" || cluster === "mainnet") return "";
  if (cluster === "localnet" || cluster === "custom") {
    return `?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  }
  return `?cluster=${cluster}`;
}

/**
 * Build an explorer link. If NEXT_PUBLIC_EXPLORER_URL already carries a query
 * (e.g. `https://explorer.solana.com/?cluster=custom&customUrl=…` on localnet), the
 * query is moved after the path instead of being glued in front of it.
 */
export function explorerLink(
  path: string,
  explorerUrl = getExplorerUrl(),
  cluster = getCluster(),
  rpcUrl = getRpcUrl(),
): string {
  const [rawBase, rawQuery] = explorerUrl.split("?", 2);
  const base = rawBase.replace(/\/+$/, "");
  const query = rawQuery ? `?${rawQuery}` : explorerClusterQuery(cluster, rpcUrl);
  return `${base}${path}${query}`;
}

export function explorerTx(sig: string): string {
  return explorerLink(`/tx/${sig}`);
}

export function explorerAddress(addr: string): string {
  return explorerLink(`/address/${addr}`);
}

export function getPhoenixEnabledFlag(): string | undefined {
  return process.env.NEXT_PUBLIC_PHOENIX_ENABLED;
}

