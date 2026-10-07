/**
 * Global banner detection helpers — docs/ui/07.
 */
import { getCluster, getRpcUrl } from "./config";

export function isProgramPaused(): boolean {
  return process.env.NEXT_PUBLIC_PROGRAM_PAUSED === "true";
}

/**
 * Heuristic wrong-cluster check (RPC URL vs expected cluster env).
 * Force with NEXT_PUBLIC_FORCE_WRONG_CLUSTER=true for demos.
 */
export function isWrongCluster(): boolean {
  if (process.env.NEXT_PUBLIC_FORCE_WRONG_CLUSTER === "true") return true;
  const expected = getCluster();
  const rpc = getRpcUrl().toLowerCase();
  if (expected === "mainnet-beta" && rpc.includes("devnet")) return true;
  if (expected === "devnet" && (rpc.includes("mainnet") || rpc.includes("mainnet-beta"))) {
    return true;
  }
  if (expected === "localnet" && (rpc.includes("devnet") || rpc.includes("mainnet"))) {
    return true;
  }
  return false;
}

export function expectedClusterLabel(): string {
  return getCluster();
}
