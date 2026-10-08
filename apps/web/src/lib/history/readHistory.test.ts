import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { readWalletHistory } from "./readHistory";
import { buildHistoryIndex } from "./classify";
import type { MarketView } from "@/lib/market/types";

const owner = Keypair.generate().publicKey;
const PHX = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";
const m = { marketId: "M", question: "Q", yesMint: "Y", noMint: "N", phoenixMarket: "P", status: "settled-yes", resolvedAt: 50 } as unknown as MarketView;
const idx = buildHistoryIndex([m], { usdcMint: "U", meridianProgramId: "MER", phoenixProgramId: PHX });
const fill = (t: number) => ({
  blockTime: t,
  meta: {
    err: null,
    preTokenBalances: [{ mint: "U", owner: owner.toBase58(), uiTokenAmount: { uiAmount: 10 } }],
    postTokenBalances: [
      { mint: "U", owner: owner.toBase58(), uiTokenAmount: { uiAmount: 5 } },
      { mint: "Y", owner: owner.toBase58(), uiTokenAmount: { uiAmount: 10 } },
    ],
  },
  transaction: { message: { instructions: [{ programId: PHX, accounts: ["a", "b", "P"], data: "1" }] } },
});

describe("readWalletHistory", () => {
  it("classifies the wallet's txs, adds settlement rows, newest first, skips failed sigs", async () => {
    const conn = {
      getSignaturesForAddress: vi.fn(async () => [
        { signature: "s2", blockTime: 30, err: null },
        { signature: "bad", blockTime: 20, err: { x: 1 } },
        { signature: "s1", blockTime: 10, err: null },
      ]),
      getParsedTransactions: vi.fn(async (sigs: string[]) => sigs.map((s) => fill(s === "s2" ? 30 : 10))),
    };
    const r = await readWalletHistory(conn as never, owner, [m], idx);
    expect(conn.getParsedTransactions).toHaveBeenCalledWith(["s2", "s1"], expect.anything());
    expect(r.rows.map((x) => [x.type, x.ts])).toEqual([["settlement", 50], ["trade", 30], ["trade", 10]]);
    expect(r.truncated).toBe(false);
  });

  it("RPC failure rejects", async () => {
    const conn = { getSignaturesForAddress: vi.fn(async () => { throw new Error("503"); }), getParsedTransactions: vi.fn() };
    await expect(readWalletHistory(conn as never, owner, [m], idx)).rejects.toThrow("503");
  });
});
