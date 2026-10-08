/**
 * Reviewers mr72-73 M3: settle-test.cjs only admin_settles with a price that carries its source
 * (ADMIN_PRICE_SOURCE, e.g. "hermes publish_time=… (expiry+2s)" from `ops-cli admin-price`, or
 * "operator: Nasdaq official close"). A bare ADMIN_PRICE_E6 — the old static/stale-price path — is refused.
 * Pure, unit-tested in apps/automation/test/staging-gates.test.ts.
 */
function adminPriceGuard({ priceE6, source }) {
  if (!priceE6) return { ok: false, reason: "ADMIN_PRICE_E6 unset" };
  if (!/^[1-9][0-9]*$/.test(String(priceE6))) return { ok: false, reason: `ADMIN_PRICE_E6 must be a positive integer (micro-USD), got ${priceE6}` };
  if (!source || !String(source).trim()) {
    return { ok: false, reason: "ADMIN_PRICE_SOURCE required with ADMIN_PRICE_E6 (M3: no unsourced/stale fallback price; use ops-cli admin-price)" };
  }
  return { ok: true, line: `admin_settle price source: ${String(source).trim()}` };
}
module.exports = { adminPriceGuard };
