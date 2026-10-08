/**
 * Route-level market id sanity (DLV-089). Edge-safe: no web3.js, just shape checks.
 * A StrikeMarket id is a base58 pubkey (32–44 chars); fixture slugs only exist where
 * fixtures are allowed (localnet, DLV-084).
 */
/** Cluster labels where fixture (sample) markets may be shown — single source for config.fixturesAllowed. */
export const FIXTURE_CLUSTERS: ReadonlySet<string> = new Set(["localnet", "localhost", "custom"]);

/** http(s) to 127.0.0.1 / localhost / [::1], any port; host must end right there (no look-alikes). */
export const LOOPBACK_RPC = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;

export function isLoopbackRpcUrl(url: string | undefined | null): boolean {
  return !!url && LOOPBACK_RPC.test(url);
}

/**
 * M2 (Reviewers, !59): a fixture-style label alone isn't enough — `custom` (or a mislabelled
 * localnet) pointed at devnet/mainnet/private RPC would show fixtures on a real chain. Fixtures
 * need the label AND a loopback RPC. `rpcUrl` defaults to the raw env (no devnet fallback).
 */
export function isFixtureCluster(
  cluster: string,
  rpcUrl: string | undefined = process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
): boolean {
  return FIXTURE_CLUSTERS.has(cluster) && isLoopbackRpcUrl(rpcUrl);
}

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FIXTURE_SLUG = /^fixture-[a-z0-9-]{1,64}$/;

export function isPlausibleMarketId(id: string, fixturesOk: boolean): boolean {
  if (BASE58_PUBKEY.test(id)) return true;
  return fixturesOk && FIXTURE_SLUG.test(id);
}
