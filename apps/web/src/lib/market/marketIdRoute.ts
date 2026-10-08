/**
 * Route-level market id sanity (DLV-089). Edge-safe: no web3.js, just shape checks.
 * A StrikeMarket id is a base58 pubkey (32–44 chars); fixture slugs only exist where
 * fixtures are allowed (localnet, DLV-084).
 */
/** Clusters where fixture (sample) markets may be shown — single source for config.fixturesAllowed. */
export const FIXTURE_CLUSTERS: ReadonlySet<string> = new Set(["localnet", "localhost", "custom"]);

export function isFixtureCluster(cluster: string): boolean {
  return FIXTURE_CLUSTERS.has(cluster);
}

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FIXTURE_SLUG = /^fixture-[a-z0-9-]{1,64}$/;

export function isPlausibleMarketId(id: string, fixturesOk: boolean): boolean {
  if (BASE58_PUBKEY.test(id)) return true;
  return fixturesOk && FIXTURE_SLUG.test(id);
}
