/**
 * DLV-090 — rpc.ts no longer swallows read errors: a missing / invalid account is a 404 (null),
 * anything else is logged and re-thrown so callers can show "unavailable" instead of fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey as RealPublicKey } from "@solana/web3.js";

const anchor = vi.hoisted(() => ({
  fetch: vi.fn(),
  all: vi.fn(),
  configFetch: vi.fn(),
}));
vi.mock("@coral-xyz/anchor", () => {
  class AnchorProvider {
    constructor(public connection: unknown) {}
  }
  class Program {
    programId: unknown;
    account = {
      strikeMarket: { fetch: anchor.fetch, all: anchor.all },
      config: { fetch: anchor.configFetch },
    };
    constructor(idl: { address: string }) {
      this.programId = new RealPublicKey(idl.address);
    }
  }
  return { AnchorProvider, Program };
});

import { fetchMarketViaRpc, fetchMarketsViaRpc } from "./rpc";
import { __resetChainReadLogForTests } from "@/lib/log/chainRead";

let err: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetChainReadLogForTests();
  anchor.fetch.mockReset();
  anchor.all.mockReset();
  anchor.configFetch.mockReset();
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => err.mockRestore());

const ID = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

describe("fetchMarketViaRpc", () => {
  it("non-pubkey id (fixture slug) → null, nothing logged", async () => {
    await expect(fetchMarketViaRpc("fixture-aapl-230-oct16", "http://127.0.0.1:1")).resolves.toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it("account does not exist → null, nothing logged", async () => {
    anchor.fetch.mockRejectedValue(new Error(`Account does not exist or has no data ${ID}`));
    await expect(fetchMarketViaRpc(ID, "http://127.0.0.1:1")).resolves.toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it("RPC failure → logged and re-thrown", async () => {
    anchor.fetch.mockRejectedValue(new Error("fetch failed"));
    await expect(fetchMarketViaRpc(ID, "http://127.0.0.1:1")).rejects.toThrow("fetch failed");
    expect(String(err.mock.calls[0]?.[0])).toContain("fetch failed");
  });
});

describe("fetchMarketsViaRpc helpers log instead of swallowing", () => {
  it("config (treasury) read failure is logged; markets still map", async () => {
    anchor.all.mockResolvedValue([]);
    anchor.configFetch.mockRejectedValue(new Error("treasury read 503"));
    await expect(fetchMarketsViaRpc("http://127.0.0.1:1")).resolves.toEqual([]);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toContain("treasury read 503");
  });
});
