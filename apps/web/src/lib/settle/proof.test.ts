import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { MERIDIAN_IDL } from "@/lib/solana/idl";
import { explorerClusterQuery, explorerLink } from "@/lib/solana/config";
import {
  ADMIN_SETTLED_DISCRIMINATOR,
  SETTLED_DISCRIMINATOR,
  buildSettleProof,
  decodeSettleEvent,
  hermesFeedUrl,
  orderSettleCandidates,
  parseSettleEventFromLogs,
} from "./proof";

const MARKET = Keypair.generate().publicKey;
const OTHER = Keypair.generate().publicKey;
const AUTH = Keypair.generate().publicKey;

function encodeEvent(opts: {
  admin?: boolean;
  market?: Uint8Array;
  priceE6: bigint;
  strikeE6: bigint;
  outcomeYes: boolean;
  conf?: bigint;
  slot?: bigint;
  ts?: bigint;
}): string {
  const len = 8 + 32 + 8 + 8 + 1 + 8 + 8 + 8 + (opts.admin ? 32 : 0);
  const b = new Uint8Array(len);
  const dv = new DataView(b.buffer);
  b.set(opts.admin ? ADMIN_SETTLED_DISCRIMINATOR : SETTLED_DISCRIMINATOR, 0);
  b.set(opts.market ?? MARKET.toBytes(), 8);
  let o = 40;
  dv.setBigUint64(o, opts.priceE6, true);
  o += 8;
  dv.setBigUint64(o, opts.strikeE6, true);
  o += 8;
  b[o] = opts.outcomeYes ? 1 : 0;
  o += 1;
  dv.setBigUint64(o, opts.conf ?? 0n, true);
  o += 8;
  dv.setBigUint64(o, opts.slot ?? 4242n, true);
  o += 8;
  dv.setBigInt64(o, opts.ts ?? 1_791_500_000n, true);
  o += 8;
  if (opts.admin) b.set(AUTH.toBytes(), o);
  return Buffer.from(b).toString("base64");
}

const marketBase = {
  underlyingSymbol: "AAPL",
  strike: 230,
  resolvedPrice: 231.5,
  resolvedAt: 1_791_500_000,
  pythFeedId: Keypair.generate().publicKey.toBase58(),
  pythFeedIdHex: "ab".repeat(32),
  settledSlot: 4242,
};

describe("settle event discriminators", () => {
  it("match the prod IDL", () => {
    const events = (MERIDIAN_IDL as { events: { name: string; discriminator: number[] }[] }).events;
    expect(events.find((e) => e.name === "Settled")!.discriminator).toEqual(SETTLED_DISCRIMINATOR);
    expect(events.find((e) => e.name === "AdminSettled")!.discriminator).toEqual(ADMIN_SETTLED_DISCRIMINATOR);
  });
});

describe("parseSettleEventFromLogs", () => {
  const settledLog = `Program data: ${encodeEvent({ priceE6: 231_500_000n, strikeE6: 230_000_000n, outcomeYes: true, conf: 5_000_000n })}`;

  it("finds Settled among other program logs", () => {
    const ev = parseSettleEventFromLogs(
      [
        "Program 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6 invoke [1]",
        "Program log: Instruction: Settle",
        "Program data: AAAA", // junk / other event
        settledLog,
        "Program 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6 success",
      ],
      MARKET.toBase58(),
    )!;
    expect(ev.kind).toBe("pyth");
    expect(ev.market).toBe(MARKET.toBase58());
    expect(ev.settlementPriceE6).toBe(231_500_000n);
    expect(ev.strikePriceE6).toBe(230_000_000n);
    expect(ev.outcomeYes).toBe(true);
    expect(ev.pythConf).toBe(5_000_000n);
    expect(ev.slot).toBe(4242);
    expect(ev.ts).toBe(1_791_500_000);
  });

  it("ignores events for another market", () => {
    expect(parseSettleEventFromLogs([settledLog], OTHER.toBase58())).toBeNull();
  });

  it("decodes AdminSettled with authority", () => {
    const log = `Program data: ${encodeEvent({ admin: true, priceE6: 228_000_000n, strikeE6: 230_000_000n, outcomeYes: false })}`;
    const ev = parseSettleEventFromLogs([log], MARKET.toBase58())!;
    expect(ev.kind).toBe("admin");
    expect(ev.outcomeYes).toBe(false);
    expect(ev.authority).toBe(AUTH.toBase58());
  });

  it("null for empty / missing logs and truncated payloads", () => {
    expect(parseSettleEventFromLogs(null, MARKET.toBase58())).toBeNull();
    expect(parseSettleEventFromLogs([], MARKET.toBase58())).toBeNull();
    const short = Buffer.from(SETTLED_DISCRIMINATOR.concat([1, 2, 3])).toString("base64");
    expect(parseSettleEventFromLogs([`Program data: ${short}`], MARKET.toBase58())).toBeNull();
    expect(decodeSettleEvent(new Uint8Array(100))).toBeNull();
  });
});

describe("buildSettleProof (D-005 ≥)", () => {
  const tx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=custom`;
  const addr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=custom`;

  it("Yes wins: price ≥ strike, conf scaled by feed expo, links built", () => {
    const ev = decodeSettleEvent(
      Buffer.from(encodeEvent({ priceE6: 231_500_000n, strikeE6: 230_000_000n, outcomeYes: true, conf: 5_000_000n }), "base64"),
    )!;
    const p = buildSettleProof({
      market: { ...marketBase, status: "settled-yes" },
      event: ev,
      signature: "SIG123",
      feedExpo: -8,
      explorerTx: tx,
      explorerAddress: addr,
    });
    expect(p.status).toBe("settled");
    expect(p.outcome).toBe("yes");
    expect(p.comparisonLine).toBe("$231.50 ≥ $230.00 → Yes wins");
    expect(p.consistent).toBe(true);
    expect(p.conf).toBeCloseTo(0.05, 8);
    expect(p.links.txUrl).toBe(tx("SIG123"));
    expect(p.links.priceAccountUrl).toBe(addr(marketBase.pythFeedId));
    expect(p.links.feedUrl).toBe(hermesFeedUrl("ab".repeat(32)));
    expect(p.settledSlot).toBe(4242);
    expect(p.notes.some((n) => n.includes("publish time"))).toBe(true);
    expect(p.notes.some((n) => n.includes("not found"))).toBe(false);
  });

  it("price exactly at strike → Yes wins (≥)", () => {
    const p = buildSettleProof({
      market: { ...marketBase, resolvedPrice: 230, status: "settled-yes" },
    });
    expect(p.comparisonLine).toBe("$230.00 ≥ $230.00 → Yes wins");
    expect(p.consistent).toBe(true);
  });

  it("No wins: price < strike", () => {
    const p = buildSettleProof({
      market: { ...marketBase, resolvedPrice: 229.99, status: "settled-no" },
    });
    expect(p.comparisonLine).toBe("$229.99 < $230.00 → No wins");
    expect(p.outcome).toBe("no");
    expect(p.consistent).toBe(true);
  });

  it("flags an inconsistent outcome", () => {
    const p = buildSettleProof({
      market: { ...marketBase, resolvedPrice: 225, status: "settled-yes" },
    });
    expect(p.consistent).toBe(false);
    expect(p.notes[0]).toMatch(/does not match/);
  });

  it("no tx found → market-account values + note; suppressed while loading", () => {
    const done = buildSettleProof({ market: { ...marketBase, status: "settled-yes" } });
    expect(done.settlementPrice).toBe(231.5);
    expect(done.signature).toBeUndefined();
    expect(done.notes.some((n) => n.includes("not found"))).toBe(true);
    const loading = buildSettleProof({ market: { ...marketBase, status: "settled-yes" }, lookupDone: false });
    expect(loading.notes.some((n) => n.includes("not found"))).toBe(false);
  });

  it("admin settle: no conf, admin note; mock feed → no Hermes link", () => {
    const ev = decodeSettleEvent(
      Buffer.from(encodeEvent({ admin: true, priceE6: 228_000_000n, strikeE6: 230_000_000n, outcomeYes: false }), "base64"),
    )!;
    const p = buildSettleProof({
      market: { ...marketBase, resolvedPrice: 228, status: "settled-no" },
      event: ev,
      feedExpo: -8,
      mockFeed: true,
    });
    expect(p.kind).toBe("admin");
    expect(p.conf).toBeUndefined();
    expect(p.links.feedUrl).toBeUndefined();
    expect(p.notes.some((n) => n.includes("admin"))).toBe(true);
  });

  it("settling / void statuses", () => {
    expect(buildSettleProof({ market: { ...marketBase, status: "settling" } }).status).toBe("settling");
    const v = buildSettleProof({ market: { ...marketBase, status: "void" } });
    expect(v.status).toBe("void");
    expect(v.comparisonLine).toBeUndefined();
  });
});

describe("orderSettleCandidates", () => {
  it("drops failed txs and puts the settled_slot match first", () => {
    const sigs = [
      { signature: "a", slot: 10 },
      { signature: "b", slot: 9, err: { InstructionError: [0, "Custom"] } },
      { signature: "c", slot: 8 },
      { signature: "d", slot: 7 },
    ];
    expect(orderSettleCandidates(sigs, 8).map((s) => s.signature)).toEqual(["c", "a", "d"]);
    expect(orderSettleCandidates(sigs).map((s) => s.signature)).toEqual(["a", "c", "d"]);
  });
});

describe("explorerClusterQuery", () => {
  it("localnet → custom RPC param; devnet → cluster; mainnet → none", () => {
    expect(explorerClusterQuery("localnet", "http://127.0.0.1:8899")).toBe(
      "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
    );
    expect(explorerClusterQuery("devnet", "x")).toBe("?cluster=devnet");
    expect(explorerClusterQuery("mainnet-beta", "x")).toBe("");
  });

  it("explorerLink keeps a query baked into NEXT_PUBLIC_EXPLORER_URL after the path", () => {
    expect(
      explorerLink(
        "/tx/SIG",
        "https://explorer.solana.com/?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
        "localnet",
        "http://127.0.0.1:8899",
      ),
    ).toBe("https://explorer.solana.com/tx/SIG?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899");
    expect(explorerLink("/tx/SIG", "https://explorer.solana.com", "localnet", "http://127.0.0.1:8899")).toBe(
      "https://explorer.solana.com/tx/SIG?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
    );
    expect(explorerLink("/address/A", "https://explorer.solana.com/", "devnet", "x")).toBe(
      "https://explorer.solana.com/address/A?cluster=devnet",
    );
  });
});
