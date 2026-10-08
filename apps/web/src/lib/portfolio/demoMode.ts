/**
 * Demo-data gating (DLV-088). `lib/demo/portfolio` is a localnet fixture-mode convenience only:
 * shown when the app is displaying fixture markets on a localnet-style cluster. Devnet/mainnet
 * and real localnet markets always use on-chain reads.
 */
import { isFixtureCluster } from "@/lib/market/marketIdRoute";
import { getCluster } from "@/lib/solana/config";

export function isFixtureMarketId(marketId: string): boolean {
  return marketId.startsWith("fixture-");
}

/** Portfolio / History / Header redeem dot. */
export function demoAccountAllowed(opts: { cluster?: string; usedFixtures: boolean }): boolean {
  return isFixtureCluster(opts.cluster ?? getCluster()) && opts.usedFixtures;
}

/** Per-market availability (trade ticket / list Buy buttons). */
export function demoMarketAllowed(marketId: string, cluster = getCluster()): boolean {
  return isFixtureCluster(cluster) && isFixtureMarketId(marketId);
}
