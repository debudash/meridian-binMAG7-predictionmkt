/**
 * Reviewers mr72-73 M3: the admin_settle fallback price for staging/ops.
 *
 * Never a stale account price. Order:
 *   1. the Hermes price at expiry (the same `/v2/updates/price/{expiry_ts}` call pull settle makes): accepted
 *      only if it is the market's feed, |publish_time − expiry| ≤ maxSkewSecs, price > 0 and conf ≤ maxConfBps;
 *   2. otherwise an operator-supplied price (OPERATOR_PRICE_E6) — only with its source (OPERATOR_PRICE_SOURCE)
 *      and bound to this exact market (OPERATOR_PRICE_MARKET), so a leftover value can't settle another market;
 *   3. otherwise REFUSED. The caller must stop and ask for an operator price; it never falls back silently.
 * A valid Hermes price always wins over an operator price.
 */
import type { PullPrice } from "./pullOracle";

export type AdminPriceDecision =
  | { ok: true; priceE6: bigint; source: string }
  | { ok: false; reason: string };

export interface OperatorPrice {
  priceE6?: string;
  source?: string;
  market?: string;
}

/** Pyth (price, expo) → integer micro-units, half-up. */
export function priceToE6(price: bigint, expo: number): bigint {
  const shift = expo + 6;
  if (shift >= 0) return price * 10n ** BigInt(shift);
  const d = 10n ** BigInt(-shift);
  return (price + d / 2n) / d;
}

/**
 * !77 L-1: max |publish_time − expiry| for the Hermes admin price. Defaults to 60 s, the on-chain Pyth publish window
 * (check_publish_window, D-025); up to 300 s only as an explicit override that the caller logs; anything else throws.
 */
export const ADMIN_PRICE_DEFAULT_SKEW_SECS = 60;
export const ADMIN_PRICE_MAX_OVERRIDE_SKEW_SECS = 300;
export function adminPriceMaxSkewSecs(env: { ADMIN_PRICE_MAX_SKEW_SECS?: string }): { secs: number; override?: string } {
  const raw = env.ADMIN_PRICE_MAX_SKEW_SECS;
  if (raw === undefined || raw.trim() === "") return { secs: ADMIN_PRICE_DEFAULT_SKEW_SECS };
  if (!/^\d+$/.test(raw.trim()) || Number(raw) > ADMIN_PRICE_MAX_OVERRIDE_SKEW_SECS) {
    throw new Error(`ADMIN_PRICE_MAX_SKEW_SECS must be an integer 0..${ADMIN_PRICE_MAX_OVERRIDE_SKEW_SECS} (default ${ADMIN_PRICE_DEFAULT_SKEW_SECS}, the on-chain window)`);
  }
  const secs = Number(raw);
  if (secs <= ADMIN_PRICE_DEFAULT_SKEW_SECS) return { secs };
  return { secs, override: `ADMIN_PRICE_MAX_SKEW_SECS override: ${secs}s (> the ${ADMIN_PRICE_DEFAULT_SKEW_SECS}s on-chain publish window)` };
}

const OPERATOR_HINT =
  "supply the real expiry price: OPERATOR_PRICE_E6=<integer micro-USD> OPERATOR_PRICE_SOURCE=<where it came from> " +
  "OPERATOR_PRICE_MARKET=<strike market>";

export function decideAdminFallbackPrice(opts: {
  market: string;
  expiryTs: number;
  feedIdHex: string;
  maxSkewSecs: number;
  maxConfBps: number;
  hermes: { parsed: PullPrice } | { error: string };
  operator?: OperatorPrice;
}): AdminPriceDecision {
  let hermesWhy: string;
  if ("parsed" in opts.hermes) {
    const p = opts.hermes.parsed;
    const skew = p.publishTime - opts.expiryTs;
    const want = opts.feedIdHex.replace(/^0x/, "").toLowerCase();
    if (p.feedIdHex.replace(/^0x/, "").toLowerCase() !== want) {
      hermesWhy = `Hermes feed ${p.feedIdHex} != market feed ${want}`;
    } else if (Math.abs(skew) > opts.maxSkewSecs) {
      hermesWhy = `Hermes publish_time ${p.publishTime} is ${Math.abs(skew)}s from expiry ${opts.expiryTs} (> ${opts.maxSkewSecs}s; stale or off-hours)`;
    } else if (p.price <= 0n) {
      hermesWhy = "Hermes price is non-positive";
    } else if ((p.conf * 10_000n) / p.price > BigInt(opts.maxConfBps)) {
      hermesWhy = `Hermes conf ratio ${(p.conf * 10_000n) / p.price} bps > ${opts.maxConfBps}`;
    } else {
      return {
        ok: true,
        priceE6: priceToE6(p.price, p.expo),
        source: `hermes publish_time=${p.publishTime} (expiry${skew >= 0 ? "+" : ""}${skew}s) feed=${want.slice(0, 8)}…`,
      };
    }
  } else {
    hermesWhy = `Hermes unavailable: ${opts.hermes.error}`;
  }

  const op = opts.operator;
  if (op?.priceE6) {
    if (!/^[1-9][0-9]*$/.test(op.priceE6)) return { ok: false, reason: `${hermesWhy}; OPERATOR_PRICE_E6 must be a positive integer (micro-USD)` };
    if (!op.source?.trim()) return { ok: false, reason: `${hermesWhy}; OPERATOR_PRICE_SOURCE is required with OPERATOR_PRICE_E6` };
    if (op.market !== opts.market) {
      return { ok: false, reason: `${hermesWhy}; OPERATOR_PRICE_MARKET (${op.market ?? "unset"}) must equal ${opts.market}` };
    }
    return { ok: true, priceE6: BigInt(op.priceE6), source: `operator: ${op.source.trim()}` };
  }
  return { ok: false, reason: `${hermesWhy}; refusing automatic admin_settle — ${OPERATOR_HINT}` };
}
