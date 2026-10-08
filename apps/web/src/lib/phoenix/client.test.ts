/**
 * M1 / L12 (Reviewers): a non-lot-aligned size must be refused before anything is signed —
 * Buy No 2.5 used to mint 2.5 pairs and IOC-sell only 2 Yes; Sell No 2.5 could quietly consume
 * seat Yes via the auto-sweep. Mint raw and the Phoenix order must use the same lot count.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

const sdk = vi.hoisted(() => {
  const iocCalls: Array<{ sizeInBaseUnits: number; minBaseUnitsToFill: number }> = [];
  const state = { metadata: { baseLotSize: 1_000_000, baseLotsPerBaseUnit: 1, rawBaseUnitsPerBaseUnit: 1 } };
  return { iocCalls, state };
});
const mintAmounts = vi.hoisted(() => [] as string[]);

vi.mock("@ellipsis-labs/phoenix-sdk", () => {
  const ix = () =>
    new TransactionInstruction({ programId: new PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY"), keys: [], data: Buffer.alloc(0) });
  return {
    Side: { Bid: 0, Ask: 1 },
    SelfTradeBehavior: { Abort: 0 },
    Client: {
      createWithoutConfig: async (_c: unknown, markets: PublicKey[]) => ({
        marketStates: new Map(),
        marketMetadatas: new Map([[markets[0].toBase58(), sdk.state.metadata]]),
        getImmediateOrCancelOrderIxfromTemplate: (_k: string, _t: PublicKey, p: { sizeInBaseUnits: number; minBaseUnitsToFill: number }) => {
          sdk.iocCalls.push(p);
          return ix();
        },
        getLimitOrderInstructionfromTemplate: () => ix(),
        getPostOnlyOrderInstructionfromTemplate: () => ix(),
      }),
    },
  };
});
vi.mock("./seat", () => ({ buildClaimSeatInstructions: async () => ({ instructions: [] }) }));
vi.mock("@/lib/solana/instructions", () => {
  const ix = () => new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.alloc(0) });
  return {
    buildMintIx: async (_p: unknown, _a: unknown, amount: { toString(): string }) => {
      mintAmounts.push(amount.toString());
      return { instruction: async () => ix() };
    },
    buildMergeIx: async (_p: unknown, _a: unknown, amount: { toString(): string }) => {
      mintAmounts.push(amount.toString());
      return { instruction: async () => ix() };
    },
  };
});

import { placePhoenixOrder } from "./client";

const user = Keypair.generate().publicKey;
const pk = () => Keypair.generate().publicKey;
const mintAccounts = {
  user,
  strikeMarket: pk(),
  collateralVault: pk(),
  yesMint: pk(),
  noMint: pk(),
  treasury: pk(),
  collateralMint: pk(),
};

function ctx() {
  const sendTransaction = vi.fn(async () => "SIG");
  return {
    sendTransaction,
    ctx: {
      connection: { getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }) } as never,
      publicKey: user,
      sendTransaction,
      program: {} as never,
      mintAccounts,
    },
  };
}

const req = (intent: "buy-no" | "sell-no" | "buy-yes", size: number, lotSize?: number) => ({
  phoenixMarket: pk().toBase58(),
  intent,
  price: 0.4,
  size,
  orderType: "market" as const,
  worstPrice: 0.42,
  tickSize: 0.01,
  lotSize,
});

beforeEach(() => {
  sdk.iocCalls.length = 0;
  mintAmounts.length = 0;
  sdk.state.metadata = { baseLotSize: 1_000_000, baseLotsPerBaseUnit: 1, rawBaseUnitsPerBaseUnit: 1 };
});

describe("placePhoenixOrder lot alignment (M1)", () => {
  it.each([2.5, 0.29, 0, -3])("Buy No %s → refused before signing", async (size) => {
    const { ctx: c, sendTransaction } = ctx();
    const r = await placePhoenixOrder(req("buy-no", size, 1), c);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-size");
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(mintAmounts).toEqual([]);
  });

  it("L12: Sell No 2.5 → refused before signing (sweep can't top up the merge)", async () => {
    const { ctx: c, sendTransaction } = ctx();
    const r = await placePhoenixOrder(req("sell-no", 2.5, 1), c);
    expect(r.reason).toBe("invalid-size");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("the loaded Phoenix market's lot wins over a looser ticket lot", async () => {
    const { ctx: c, sendTransaction } = ctx();
    const r = await placePhoenixOrder(req("buy-no", 2.5, 0.5), c);
    expect(r.reason).toBe("invalid-size");
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("Buy No 3 → mint raw 3e6 and the IOC ask floors to exactly 3 lots (fill-or-kill on the same size)", async () => {
    const { ctx: c, sendTransaction } = ctx();
    const r = await placePhoenixOrder(req("buy-no", 3, 1), c);
    expect(r.ok).toBe(true);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(mintAmounts).toEqual(["3000000"]);
    const p = sdk.iocCalls[0];
    expect(Math.floor(p.sizeInBaseUnits)).toBe(3);
    expect(Math.floor(p.minBaseUnitsToFill)).toBe(3);
  });

  it("0.01-contract lots: Buy No 0.29 mints 290000 and asks 29 lots", async () => {
    sdk.state.metadata = { baseLotSize: 10_000, baseLotsPerBaseUnit: 100, rawBaseUnitsPerBaseUnit: 1 };
    const { ctx: c } = ctx();
    const r = await placePhoenixOrder(req("buy-no", 0.29, 0.01), c);
    expect(r.ok).toBe(true);
    expect(mintAmounts).toEqual(["290000"]);
    expect(Math.floor(sdk.iocCalls[0].sizeInBaseUnits * 100)).toBe(29);
    expect(Math.floor(sdk.iocCalls[0].minBaseUnitsToFill * 100)).toBe(29);
  });
});
