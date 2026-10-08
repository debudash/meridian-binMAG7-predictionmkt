/**
 * Reviewers / Track A smoke (6d04b00): one settled market pointing at a Phoenix book that no
 * longer exists on :8899 made the batched SDK load throw ("Unable to get account data"), which
 * blanked the quotes on EVERY market card. A missing, failed or undecodable book must only blank
 * its own card; every other card keeps its live quote.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

const sdk = vi.hoisted(() => ({
  ladders: new Map<string, { bids: { price: number }[]; asks: { price: number }[] }>(),
  ladderArgs: [] as Array<{ levels: unknown; slot: unknown; ts: unknown }>,
}));

vi.mock("@ellipsis-labs/phoenix-sdk", () => ({
  MarketState: {
    load: ({ address, buffer }: { address: PublicKey; buffer: Buffer }) => {
      if (buffer.toString() !== "phoenix-market") throw new Error("Invalid market account discriminant");
      const ladder = sdk.ladders.get(address.toBase58()) ?? { bids: [], asks: [] };
      return {
        getUiLadder: (levels: unknown, slot: unknown, ts: unknown) => {
          sdk.ladderArgs.push({ levels, slot, ts });
          return ladder;
        },
      };
    },
  },
}));

import { attachPhoenixQuotes, decodeClockSysvar } from "./phoenixQuotes";
import { __resetChainReadLogForTests } from "@/lib/log/chainRead";
import type { MarketView } from "@/lib/market/types";

const SLOT = 123_456n;
const TS = 1_791_400_000n;
function clockBuffer(): Buffer {
  const b = Buffer.alloc(40);
  b.writeBigUInt64LE(SLOT, 0);
  b.writeBigInt64LE(0n, 8);
  b.writeBigUInt64LE(7n, 16);
  b.writeBigUInt64LE(8n, 24);
  b.writeBigInt64LE(TS, 32);
  return b;
}
const marketAccount = () => ({ data: Buffer.from("phoenix-market"), executable: false, lamports: 1, owner: PublicKey.default });

function view(marketId: string, phoenixMarket: string | undefined, extra: Partial<MarketView> = {}): MarketView {
  return {
    marketId,
    question: marketId,
    underlyingSymbol: "AAPL",
    strike: 225,
    comparator: ">=",
    tradingCloseTs: 0,
    settleTs: 0,
    status: "open",
    phoenixMarket,
    tickSize: 0.01,
    lotSize: 1,
    minPrice: 0.01,
    maxPrice: 0.99,
    ...extra,
  };
}

type Info = ReturnType<typeof marketAccount> | null;
function fakeConnection(byKey: (k: PublicKey) => Info | Error) {
  const calls: PublicKey[][] = [];
  return {
    calls,
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) => {
      calls.push(keys);
      return keys.map((k) => {
        if (k.equals(SYSVAR_CLOCK_PUBKEY)) return { ...marketAccount(), data: clockBuffer() };
        const r = byKey(k);
        if (r instanceof Error) throw r;
        return r;
      });
    }),
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sdk.ladders.clear();
  sdk.ladderArgs.length = 0;
  __resetChainReadLogForTests();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("attachPhoenixQuotes — per-book resilience", () => {
  it("a missing book and an undecodable book blank only their own cards", async () => {
    const good1 = Keypair.generate().publicKey;
    const good2 = Keypair.generate().publicKey;
    const missing = Keypair.generate().publicKey; // e.g. settled NVDA≥135 → 6QWeT6Fp… gone
    const bad = Keypair.generate().publicKey;
    sdk.ladders.set(good1.toBase58(), { bids: [{ price: 0.4 }], asks: [{ price: 0.46 }] });
    sdk.ladders.set(good2.toBase58(), { bids: [{ price: 0.7 }], asks: [] });
    const conn = fakeConnection((k) =>
      k.equals(missing) ? null : k.equals(bad) ? { ...marketAccount(), data: Buffer.from("garbage") } : marketAccount(),
    );
    const views = [
      view("good1", good1.toBase58()),
      view("missing", missing.toBase58()),
      view("bad", bad.toBase58()),
      view("good2", good2.toBase58()),
      view("nobook", undefined),
    ];

    await attachPhoenixQuotes(conn as never, views);

    const [g1, m, b, g2, nb] = views;
    expect([g1.yesBid, g1.yesAsk, g1.yesMid]).toEqual([0.4, 0.46, 0.43]);
    expect([g2.yesBid, g2.yesAsk, g2.yesMid]).toEqual([0.7, undefined, 0.7]);
    for (const v of [m, b, nb]) {
      expect(v.yesBid).toBeUndefined();
      expect(v.yesAsk).toBeUndefined();
      expect(v.yesMid).toBeUndefined();
    }
    // One batched read (books + clock sysvar), not N calls.
    expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(conn.calls[0]).toHaveLength(5);
    expect(conn.calls[0][4].equals(SYSVAR_CLOCK_PUBKEY)).toBe(true);
    // Each failure is logged against its own book.
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(missing.toBase58());
    expect(logged).toContain(bad.toBase58());
    expect(logged).not.toContain(good1.toBase58());
  });

  it("a settled market whose book is gone keeps its settlement mid", async () => {
    const missing = Keypair.generate().publicKey;
    const conn = fakeConnection(() => null);
    const v = view("nvda", missing.toBase58(), { status: "settled-yes", yesMid: 1 });
    await attachPhoenixQuotes(conn as never, [v]);
    expect(v.yesMid).toBe(1);
    expect(v.yesBid).toBeUndefined();
  });

  it("evaluates the ladder at the cluster clock (time-in-force orders expire correctly)", async () => {
    const good = Keypair.generate().publicKey;
    sdk.ladders.set(good.toBase58(), { bids: [{ price: 0.5 }], asks: [{ price: 0.52 }] });
    await attachPhoenixQuotes(fakeConnection(() => marketAccount()) as never, [view("g", good.toBase58())]);
    expect(sdk.ladderArgs).toHaveLength(1);
    expect(String(sdk.ladderArgs[0].slot)).toBe(SLOT.toString());
    expect(String(sdk.ladderArgs[0].ts)).toBe(TS.toString());
  });

  it("an RPC failure leaves all quotes unset and does not throw", async () => {
    const conn = fakeConnection(() => new Error("fetch failed"));
    const v = view("a", Keypair.generate().publicKey.toBase58());
    await expect(attachPhoenixQuotes(conn as never, [v])).resolves.toBeUndefined();
    expect(v.yesMid).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it("a non-pubkey phoenixMarket is skipped without breaking the others", async () => {
    const good = Keypair.generate().publicKey;
    sdk.ladders.set(good.toBase58(), { bids: [{ price: 0.3 }], asks: [{ price: 0.32 }] });
    const conn = fakeConnection(() => marketAccount());
    const views = [view("fixture", "not-a-pubkey"), view("g", good.toBase58())];
    await attachPhoenixQuotes(conn as never, views);
    expect(views[0].yesMid).toBeUndefined();
    expect(views[1].yesMid).toBe(0.31);
    expect(conn.calls[0]).toHaveLength(2);
  });

  it("chunks >99 books so each read stays within the 100-account RPC limit", async () => {
    const keys = Array.from({ length: 150 }, () => Keypair.generate().publicKey);
    keys.forEach((k) => sdk.ladders.set(k.toBase58(), { bids: [{ price: 0.2 }], asks: [{ price: 0.22 }] }));
    const conn = fakeConnection(() => marketAccount());
    const views = keys.map((k, i) => view(`m${i}`, k.toBase58()));
    await attachPhoenixQuotes(conn as never, views);
    expect(conn.calls.length).toBe(2);
    for (const c of conn.calls) expect(c.length).toBeLessThanOrEqual(100);
    expect(views.every((v) => v.yesMid === 0.21)).toBe(true);
  });
});

describe("decodeClockSysvar", () => {
  it("reads slot and unix_timestamp", () => {
    const c = decodeClockSysvar(clockBuffer());
    expect(c?.slot.toString()).toBe(SLOT.toString());
    expect(c?.unixTimestamp.toString()).toBe(TS.toString());
  });
  it("returns null for a short buffer", () => {
    expect(decodeClockSysvar(Buffer.alloc(10))).toBeNull();
  });
});
