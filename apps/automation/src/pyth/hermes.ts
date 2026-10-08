/**
 * Hermes client (D-025). Since the Pyth Core upgrade (2026-08-26) every Hermes request needs
 * `Authorization: Bearer <PYTH_HERMES_API_KEY>`; unauthenticated calls return 401.
 */
import { PullPrice } from "./pullOracle";

export const DEFAULT_HERMES_URL = "https://hermes.pyth.network";

export class HermesApiKeyError extends Error {
  constructor(detail: string) {
    super(
      `${detail} — Hermes requires an API key since 2026-08-26; set PYTH_HERMES_API_KEY ` +
        `(Pyth Terminal key). Without it automation cannot post a settle price; admin_settle remains the fallback.`
    );
    this.name = "HermesApiKeyError";
  }
}

export interface HermesUpdate {
  /** Base64 accumulator update(s) for PythSolanaReceiver.addPostPriceUpdates. */
  vaas: string[];
  parsed: PullPrice;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}>;

export function hermesUpdateUrl(baseUrl: string, feedIdHex: string, publishTime: number): string {
  const id = feedIdHex.startsWith("0x") ? feedIdHex : `0x${feedIdHex}`;
  return `${baseUrl.replace(/\/+$/, "")}/v2/updates/price/${publishTime}?ids[]=${id}&encoding=base64&parsed=true`;
}

/** First Pyth update with publish_time >= `publishTime` (Hermes "price at timestamp" route). */
export async function fetchUpdateAt(opts: {
  baseUrl?: string;
  apiKey: string | undefined;
  feedIdHex: string;
  publishTime: number;
  fetchImpl?: FetchLike;
}): Promise<HermesUpdate> {
  if (!opts.apiKey) throw new HermesApiKeyError("PYTH_HERMES_API_KEY is not set");
  const f: FetchLike = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
  const url = hermesUpdateUrl(opts.baseUrl ?? DEFAULT_HERMES_URL, opts.feedIdHex, opts.publishTime);
  const res = await f(url, { headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) {
    // 403 "Not entitled" = the key is valid but its plan has no grant for this feed (e.g. equities). Never echo the key.
    const body = (await res.text().catch(() => "")).slice(0, 200);
    const why = /not entitled/i.test(body)
      ? `Hermes key is valid but not entitled to this feed (HTTP ${res.status}: ${(body.match(/\(no grant[^]*$/)?.[0] ?? "").slice(0, 120)})`
      : `Hermes rejected the API key (HTTP ${res.status})`;
    throw new HermesApiKeyError(why);
  }
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const vaas: string[] = body?.binary?.data ?? [];
  const want = opts.feedIdHex.replace(/^0x/, "").toLowerCase();
  const p = (body?.parsed ?? []).find((x: any) => String(x.id).replace(/^0x/, "").toLowerCase() === want);
  if (!vaas.length || !p) throw new Error(`Hermes returned no update for feed ${want} at ${opts.publishTime}`);
  return {
    vaas,
    parsed: {
      feedIdHex: want,
      price: BigInt(p.price.price),
      conf: BigInt(p.price.conf),
      expo: Number(p.price.expo),
      publishTime: Number(p.price.publish_time),
      prevPublishTime: Number(p.metadata?.prev_publish_time ?? NaN),
    },
  };
}

/**
 * DLV-118: latest parsed price for a feed (strike reference at the 9:30 ET open). Same auth + 401/403 handling as
 * fetchUpdateAt; equities are currently 403 "not entitled" (DLV-106), so callers fall back to operator prices.
 */
export async function fetchLatestPrice(opts: {
  baseUrl?: string;
  apiKey: string | undefined;
  feedIdHex: string;
  fetchImpl?: FetchLike;
}): Promise<PullPrice> {
  if (!opts.apiKey) throw new HermesApiKeyError("PYTH_HERMES_API_KEY is not set");
  const f: FetchLike = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
  const id = opts.feedIdHex.startsWith("0x") ? opts.feedIdHex : `0x${opts.feedIdHex}`;
  const url = `${(opts.baseUrl ?? DEFAULT_HERMES_URL).replace(/\/+$/, "")}/v2/updates/price/latest?ids[]=${id}&parsed=true`;
  const res = await f(url, { headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" } });
  if (res.status === 401 || res.status === 403) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new HermesApiKeyError(/not entitled/i.test(body) ? `Hermes key is valid but not entitled to this feed (HTTP ${res.status})` : `Hermes rejected the API key (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const want = opts.feedIdHex.replace(/^0x/, "").toLowerCase();
  const p = (body?.parsed ?? []).find((x: any) => String(x.id).replace(/^0x/, "").toLowerCase() === want);
  if (!p) throw new Error(`Hermes returned no latest price for feed ${want}`);
  return {
    feedIdHex: want,
    price: BigInt(p.price.price),
    conf: BigInt(p.price.conf),
    expo: Number(p.price.expo),
    publishTime: Number(p.price.publish_time),
    prevPublishTime: Number(p.metadata?.prev_publish_time ?? NaN),
  };
}
