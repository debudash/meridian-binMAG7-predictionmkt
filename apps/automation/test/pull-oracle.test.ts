/**
 * DLV-078 / D-025 — automation pull-oracle settle: Hermes client, PriceUpdateV2 decode,
 * client-side settle rule, and the sponsored → Hermes+post orchestration.
 */
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  checkSettlePrice,
  decodePriceUpdateV2,
  publishWindowSecs,
  PYTH_RECEIVER_PROGRAM_ID,
  PullPrice,
} from "../src/pyth/pullOracle";
import { fetchUpdateAt, hermesUpdateUrl, HermesApiKeyError, FetchLike } from "../src/pyth/hermes";
import { settleWithPullOracle, PullSettleDeps } from "../src/solana/pullSettle";
import { loadConfig } from "../src/config";

const AAPL = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
// devnet push feed shard-1 AAPL D9uk39pq… (2026-10-08, Full, $336.33, publish 1791425101, prev 1791425100)
const REAL_DEVNET =
  "IvEjY51+9M20lIZyMNU/Ew6sDypIEyPeOYmooRWTOJq2X67JeylJMQFJ9rZcsd5rEOr3XnwDygKcMG0DV+kbUxGxdQhKWtVWiOgyAQIAAAAAxAkAAAAAAAD7////TfrGagAAAABM+sZqAAAAAOQzAQIAAAAABAAAAAAAAAD9iFEeAAAAAAA=";
const EXPIRY = 1_791_489_600;
const RULE = { windowSecs: 60, maxConfBps: 500 };

function price(over: Partial<PullPrice> = {}): PullPrice {
  return {
    feedIdHex: AAPL,
    price: 23_512_345_000n,
    conf: 5_000_000n,
    expo: -8,
    publishTime: EXPIRY + 1,
    prevPublishTime: EXPIRY - 1,
    ...over,
  };
}

function fakeFetch(status: number, body: any, seen: { url?: string; headers?: Record<string, string> } = {}): FetchLike {
  return async (url, init) => {
    seen.url = url;
    seen.headers = init?.headers;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
  };
}

const HERMES_BODY = {
  binary: { encoding: "base64", data: ["UE5BVQEAAAADuAEAAAAEDQ=="] },
  parsed: [
    {
      id: AAPL,
      price: { price: "23512345000", conf: "5000000", expo: -8, publish_time: EXPIRY + 1 },
      ema_price: { price: "23500000000", conf: "5000000", expo: -8, publish_time: EXPIRY + 1 },
      metadata: { slot: 1, proof_available_time: EXPIRY + 2, prev_publish_time: EXPIRY - 1 },
    },
  ],
};

describe("DLV-078 pull oracle — PriceUpdateV2 decode", () => {
  it("decodes real devnet shard-1 AAPL bytes", () => {
    const u = decodePriceUpdateV2(Buffer.from(REAL_DEVNET, "base64"));
    expect(u.fullyVerified).to.equal(true);
    expect(u.feedIdHex).to.equal(AAPL);
    expect(u.price).to.equal(33_633_000n);
    expect(u.expo).to.equal(-5);
    expect(u.publishTime).to.equal(1_791_425_101);
    expect(u.prevPublishTime).to.equal(1_791_425_100);
  });
  it("rejects non-PriceUpdateV2 data", () => {
    expect(() => decodePriceUpdateV2(Buffer.alloc(134))).to.throw("not a PriceUpdateV2");
  });
  it("publish window = staleness slots × 0.4 s (D-005 150 → 60 s)", () => {
    expect(publishWindowSecs(150)).to.equal(60);
  });
});

describe("DLV-078 pull oracle — settle rule (mirrors program)", () => {
  const o = { expiryTs: EXPIRY, feedIdHex: AAPL, ...RULE };
  it("first update after expiry inside window → ok", () => expect(checkSettlePrice(price(), o).ok).to.equal(true));
  it("feed mismatch → InvalidPythAccount", () =>
    expect((checkSettlePrice(price({ feedIdHex: "00".repeat(32) }), o) as any).code).to.equal("InvalidPythAccount"));
  it("before expiry / not first → PythPriceNotAtExpiry", () => {
    expect((checkSettlePrice(price({ publishTime: EXPIRY - 1, prevPublishTime: EXPIRY - 2 }), o) as any).code).to.equal("PythPriceNotAtExpiry");
    expect((checkSettlePrice(price({ publishTime: EXPIRY + 3, prevPublishTime: EXPIRY + 2 }), o) as any).code).to.equal("PythPriceNotAtExpiry");
  });
  it("after window → StalePythPrice", () =>
    expect((checkSettlePrice(price({ publishTime: EXPIRY + 61 }), o) as any).code).to.equal("StalePythPrice"));
  it("wide conf → PythConfidenceTooWide", () =>
    expect((checkSettlePrice(price({ conf: 1_200_000_000n }), o) as any).code).to.equal("PythConfidenceTooWide"));
});

describe("DLV-078 Hermes client (API key gated since 2026-08-26)", () => {
  it("builds /v2/updates/price/{expiry} URL with 0x id, base64, parsed", () => {
    expect(hermesUpdateUrl("https://hermes.pyth.network/", AAPL, EXPIRY)).to.equal(
      `https://hermes.pyth.network/v2/updates/price/${EXPIRY}?ids[]=0x${AAPL}&encoding=base64&parsed=true`
    );
  });
  it("missing PYTH_HERMES_API_KEY → HermesApiKeyError without a network call", async () => {
    let called = false;
    const f: FetchLike = async () => {
      called = true;
      throw new Error("no");
    };
    try {
      await fetchUpdateAt({ apiKey: undefined, feedIdHex: AAPL, publishTime: EXPIRY, fetchImpl: f });
      expect.fail("should throw");
    } catch (e) {
      expect(e).to.be.instanceOf(HermesApiKeyError);
      expect(String(e)).to.contain("PYTH_HERMES_API_KEY");
    }
    expect(called).to.equal(false);
  });
  it("sends Authorization: Bearer <key> and parses vaas + prev_publish_time", async () => {
    const seen: any = {};
    const u = await fetchUpdateAt({ apiKey: "k-123", feedIdHex: AAPL, publishTime: EXPIRY, fetchImpl: fakeFetch(200, HERMES_BODY, seen) });
    expect(seen.headers.Authorization).to.equal("Bearer k-123");
    expect(u.vaas).to.deep.equal(HERMES_BODY.binary.data);
    expect(u.parsed).to.deep.equal(price());
  });
  it("HTTP 401 → HermesApiKeyError", async () => {
    try {
      await fetchUpdateAt({ apiKey: "bad", feedIdHex: AAPL, publishTime: EXPIRY, fetchImpl: fakeFetch(401, "unauthorized") });
      expect.fail("should throw");
    } catch (e) {
      expect(e).to.be.instanceOf(HermesApiKeyError);
    }
  });
});

describe("DLV-078 settleWithPullOracle orchestration", () => {
  const market = Keypair.generate().publicKey;
  const sponsored = Keypair.generate().publicKey;
  function deps(over: Partial<PullSettleDeps> & { calls?: string[] } = {}): PullSettleDeps & { calls: string[] } {
    const calls = over.calls ?? [];
    return {
      calls,
      getAccountInfo: async () => null,
      fetchUpdate: async () => {
        calls.push("hermes");
        return { vaas: ["v"], parsed: price() };
      },
      settleWithAccount: async (pk) => {
        calls.push(`settle:${pk.toBase58()}`);
        return "sigA";
      },
      postAndSettle: async (vaas, id) => {
        calls.push(`post:${vaas.join(",")}:${id}`);
        return ["p1", "p2"];
      },
      ...over,
    };
  }
  const m = { market, expiryTs: EXPIRY, feedIdHex: AAPL, sponsoredFeed: sponsored };

  it("uses the sponsored feed account when it already holds the expiry price (no Hermes)", async () => {
    const data = Buffer.from(REAL_DEVNET, "base64");
    const d = deps({ getAccountInfo: async () => ({ owner: PYTH_RECEIVER_PROGRAM_ID, data }) });
    const r = await settleWithPullOracle({ ...m, expiryTs: 1_791_425_101 }, RULE, d);
    expect(r).to.deep.equal({ ok: true, via: "sponsored", signatures: ["sigA"] });
    expect(d.calls).to.deep.equal([`settle:${sponsored.toBase58()}`]);
  });

  it("stale sponsored feed → fetches Hermes update at expiry, posts it and settles", async () => {
    const data = Buffer.from(REAL_DEVNET, "base64"); // publish 2026-10-08 02:05 ≠ EXPIRY
    const d = deps({ getAccountInfo: async () => ({ owner: PYTH_RECEIVER_PROGRAM_ID, data }) });
    const r = await settleWithPullOracle(m, RULE, d);
    expect(r).to.deep.equal({ ok: true, via: "posted", signatures: ["p1", "p2"] });
    expect(d.calls).to.deep.equal(["hermes", `post:v:${AAPL}`]);
  });

  it("sponsored account not owned by receiver is ignored", async () => {
    const d = deps({ getAccountInfo: async () => ({ owner: new PublicKey(Keypair.generate().publicKey), data: Buffer.alloc(134) }) });
    const r = await settleWithPullOracle(m, RULE, d);
    expect(r.ok).to.equal(true);
    expect(d.calls[0]).to.equal("hermes");
  });

  it("Hermes update failing the rule → not posted, reason returned", async () => {
    const d = deps({ fetchUpdate: async () => ({ vaas: ["v"], parsed: price({ publishTime: EXPIRY + 900, prevPublishTime: EXPIRY - 5 }) }) });
    const r = await settleWithPullOracle(m, RULE, d);
    expect(r.ok).to.equal(false);
    expect((r as any).reason).to.contain("StalePythPrice");
    expect(d.calls.some((c) => c.startsWith("post"))).to.equal(false);
  });

  it("no API key → ok:false, needsApiKey, nothing posted", async () => {
    const d = deps({
      fetchUpdate: (id, t) => fetchUpdateAt({ apiKey: undefined, feedIdHex: id, publishTime: t }),
    });
    const r = await settleWithPullOracle(m, RULE, d);
    expect(r.ok).to.equal(false);
    expect((r as any).needsApiKey).to.equal(true);
    expect((r as any).reason).to.contain("PYTH_HERMES_API_KEY");
  });
});

describe("DLV-078 config — Hermes env", () => {
  it("PYTH_HERMES_API_KEY / PYTH_HERMES_URL are read; default URL hermes.pyth.network", () => {
    const base = { SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any;
    expect(loadConfig(base).pythHermesApiKey).to.equal(undefined);
    expect(loadConfig(base).pythHermesUrl).to.equal("https://hermes.pyth.network");
    const c = loadConfig({ ...base, PYTH_HERMES_API_KEY: "abc", PYTH_HERMES_URL: "https://pyth.dourolabs.app/hermes" });
    expect(c.pythHermesApiKey).to.equal("abc");
    expect(c.pythHermesUrl).to.equal("https://pyth.dourolabs.app/hermes");
  });
});

describe("DLV-078 calendar settle pass routes off-localnet markets through the pull oracle", () => {
  it("devnet: expired Open market → settleWithPullOracle (feed id from market), no legacy settle", async () => {
    const { runSettlePass, createCalendarState } = await import("../src/modes/calendar");
    const market = Keypair.generate().publicKey;
    const feed = Keypair.generate().publicKey;
    const seen: string[] = [];
    let legacyCalled = false;
    const program: any = {
      programId: new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6"),
      account: {
        strikeMarket: {
          all: async () => [
            {
              publicKey: market,
              account: {
                status: 0,
                expiryTs: { toString: () => String(EXPIRY) },
                equitySymbol: Buffer.from("AAPL    "),
                pythPriceFeed: feed,
                pythFeedId: Array.from(Buffer.from(AAPL, "hex")),
              },
            },
          ],
        },
        config: { fetch: async () => ({ settleMaxStalenessSlots: { toString: () => "150" }, settleMaxConfRatioBps: 200 }) },
      },
      methods: new Proxy({}, { get: () => () => { legacyCalled = true; throw new Error("legacy settle must not run"); } }),
    };
    const cfg = { ...loadConfig({ SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any), settleHourEt: 16 };
    await runSettlePass({
      cfg,
      program,
      authority: Keypair.generate(),
      state: createCalendarState(),
      now: new Date((EXPIRY + 120) * 1000),
      pullDeps: () => ({
        getAccountInfo: async () => null,
        fetchUpdate: async (id, t) => {
          seen.push(`hermes:${id}:${t}`);
          return { vaas: ["v"], parsed: price({ conf: 1_000_000n }) };
        },
        settleWithAccount: async () => "x",
        postAndSettle: async () => {
          seen.push("post");
          return ["s"];
        },
      }),
    });
    expect(seen).to.deep.equal([`hermes:${AAPL}:${EXPIRY}`, "post"]);
    expect(legacyCalled).to.equal(false);
  });
});

describe("D-025 morning create requires a Pyth feed id off-localnet", () => {
  it("devnet: symbol without PYTH_FEED_IDS is skipped (no create tx)", async () => {
    const { runMorningCreate, createCalendarState } = await import("../src/modes/calendar");
    let created = 0;
    const program: any = { methods: new Proxy({}, { get: () => () => { created++; throw new Error("no create expected"); } }) };
    const cfg = {
      ...loadConfig({
        SOLANA_CLUSTER: "devnet",
        SOLANA_RPC_URL: "http://x",
        COLLATERAL_MINT: Keypair.generate().publicKey.toBase58(),
        PYTH_PRICE_FEEDS: JSON.stringify({ AAPL: Keypair.generate().publicKey.toBase58() }),
      } as any),
    };
    // 2026-10-08 08:15 ET (create hour 8)
    const out = await runMorningCreate({ cfg, program, authority: Keypair.generate(), state: createCalendarState(), now: new Date("2026-10-08T12:15:00Z") });
    expect(out).to.deep.equal([]);
    expect(created).to.equal(0);
  });
});
