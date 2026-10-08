/**
 * Tiny server-side TTL cache with in-flight dedupe (M4 / L10). The market scan is a full
 * getProgramAccounts; page renders, /api/markets polls and getMarket misses all share one result
 * for `ttlMs`. Failed reads ({ failed: true }) are cached only for `failureTtlMs` so an RPC 429
 * isn't hammered by every request, and thrown loads are never cached.
 */
export interface TtlCache<T> {
  get(): Promise<T>;
  reset(): void;
}

export function createTtlCache<T extends { failed: boolean }>(
  load: () => Promise<T>,
  opts: { ttlMs: number; failureTtlMs: number; now?: () => number },
): TtlCache<T> {
  const now = opts.now ?? Date.now;
  let value: { v: T; until: number } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    async get() {
      if (value && now() < value.until) return value.v;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const v = await load();
          const ttl = v.failed ? opts.failureTtlMs : opts.ttlMs;
          value = ttl > 0 ? { v, until: now() + ttl } : null;
          return v;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    reset() {
      value = null;
      inflight = null;
    },
  };
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Server env: MARKET_LIST_CACHE_MS (default 20 s), MARKET_LIST_FAILURE_CACHE_MS (default 3 s). */
export function marketListCacheTtl(): { ttlMs: number; failureTtlMs: number } {
  return {
    ttlMs: envMs("MARKET_LIST_CACHE_MS", 20_000),
    failureTtlMs: envMs("MARKET_LIST_FAILURE_CACHE_MS", 3_000),
  };
}
