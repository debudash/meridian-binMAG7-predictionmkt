/**
 * Chain-read error logging (DLV-090).
 *
 * Every RPC / Phoenix / indexer read that fails must leave a trace in the server log (or the
 * browser console) instead of silently falling back. Lines are prefixed `[chain-read]` and
 * de-duplicated per scope+message for DEDUPE_MS so a 4 s poll can't flood the logs.
 */
const DEDUPE_MS = 60_000;
const lastLogged = new Map<string, number>();

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function logChainReadError(
  scope: string,
  err: unknown,
  ctx?: Record<string, unknown>,
  nowMs = Date.now(),
): void {
  const msg = errorMessage(err);
  const key = `${scope}|${msg}`;
  const prev = lastLogged.get(key);
  if (prev != null && nowMs - prev < DEDUPE_MS) return;
  lastLogged.set(key, nowMs);
  if (lastLogged.size > 500) lastLogged.clear();
  const extra = ctx && Object.keys(ctx).length ? ` ${JSON.stringify(ctx)}` : "";
  console.error(`[chain-read] ${scope} failed${extra}: ${msg}`);
}

/** De-duplicated warning for degraded-but-intentional paths (e.g. localnet fixture fallback). */
export function warnChainReadOnce(scope: string, msg: string, nowMs = Date.now()): void {
  const key = `warn|${scope}|${msg}`;
  const prev = lastLogged.get(key);
  if (prev != null && nowMs - prev < DEDUPE_MS) return;
  lastLogged.set(key, nowMs);
  console.warn(`[chain-read] ${scope} ${msg}`);
}

/**
 * True when the "error" is really "this account isn't there" (bad pubkey or no such account) —
 * a legitimate empty / 404 result, not an RPC failure.
 */
export function isMissingAccountError(err: unknown): boolean {
  const m = errorMessage(err);
  return /account does not exist|has no data|invalid public key|non-base58|could not find account/i.test(m);
}

export function __resetChainReadLogForTests(): void {
  lastLogged.clear();
}
