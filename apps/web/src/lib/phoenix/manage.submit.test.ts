/** L13 + L14: submitPhoenixManage sends one tx per chunk and reports confirmation honestly. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionInstruction } from "@solana/web3.js";

const PROGRAM = Keypair.generate().publicKey;
const cancelSizes = vi.hoisted(() => [] as number[]);
vi.mock("@ellipsis-labs/phoenix-sdk", () => ({
  Side: { Bid: 0, Ask: 1 },
  MarketState: {
    loadFromAddress: async () => ({
      data: { header: { baseParams: { mintKey: Keypair.generate().publicKey }, quoteParams: { mintKey: Keypair.generate().publicKey } } },
      createCancelMultipleOrdersByIdInstruction: (args: { params: { orders: unknown[] } }) => {
        cancelSizes.push(args.params.orders.length);
        return new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from("cancel") });
      },
      createWithdrawFundsInstruction: () => new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from("withdraw") }),
    }),
  },
}));

import { CANCEL_ORDERS_PER_TX, submitPhoenixManage } from "./manage";

const trader = Keypair.generate().publicKey;
const MKT = Keypair.generate().publicKey.toBase58();
const orders = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ side: "bid" as const, priceInTicks: "45", orderSequenceNumber: String(i + 1) }));

function ctx(confirmErrs: unknown[] = []) {
  let n = 0;
  const sendTransaction = vi.fn(async () => `SIG${++n}`);
  const confirmTransaction = vi.fn(async () => ({ value: { err: confirmErrs.shift() ?? null } }));
  return {
    sendTransaction,
    confirmTransaction,
    c: {
      connection: {
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
        confirmTransaction,
      } as never,
      publicKey: trader,
      sendTransaction,
    },
  };
}

beforeEach(() => {
  cancelSizes.length = 0;
});

describe("submitPhoenixManage", () => {
  it("Cancel all with many orders → one tx per chunk, each confirmed", async () => {
    const n = CANCEL_ORDERS_PER_TX * 2 + 3;
    const { c, sendTransaction, confirmTransaction } = ctx();
    const r = await submitPhoenixManage(MKT, { kind: "cancel", orders: orders(n) }, c);
    expect(sendTransaction).toHaveBeenCalledTimes(3);
    expect(confirmTransaction).toHaveBeenCalledTimes(3);
    expect(cancelSizes).toEqual([CANCEL_ORDERS_PER_TX, CANCEL_ORDERS_PER_TX, 3]);
    expect(r).toMatchObject({ ok: true, status: "confirmed", signatures: ["SIG1", "SIG2", "SIG3"] });
    expect(r.message).toMatch(new RegExp(`Cancelled ${n} orders`));
  });

  it("a chunk that fails on-chain stops the run and is reported as failed, not success", async () => {
    const { c, sendTransaction } = ctx([null, { InstructionError: [1, { Custom: 3 }] }]);
    const r = await submitPhoenixManage(MKT, { kind: "cancel", orders: orders(CANCEL_ORDERS_PER_TX * 3) }, c);
    expect(sendTransaction).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(new RegExp(`Cancelled ${CANCEL_ORDERS_PER_TX} of ${CANCEL_ORDERS_PER_TX * 3}`));
  });

  it("withdraw that fails on-chain → failed (L14)", async () => {
    const { c } = ctx([{ InstructionError: [0, "Custom"] }]);
    const r = await submitPhoenixManage(MKT, { kind: "withdraw" }, c);
    expect(r).toMatchObject({ ok: false, status: "failed" });
  });

  it("confirmation timeout → unconfirmed, not success (L14)", async () => {
    const { c, confirmTransaction } = ctx();
    confirmTransaction.mockRejectedValueOnce(new Error("block height exceeded"));
    const r = await submitPhoenixManage(MKT, { kind: "withdraw" }, c);
    expect(r).toMatchObject({ ok: false, status: "unconfirmed", signature: "SIG1" });
  });
});
