/**
 * DLV-087 — cancel resting orders and withdraw the Phoenix seat to the wallet.
 * Cancel = CancelMultipleOrdersById (raw on-chain OrderIds) + WithdrawFunds(all free), so
 * cancelling never leaves funds stranded in the seat. Withdraw = WithdrawFunds(all free).
 * ATAs for Yes + USDC are created idempotently first (withdraw needs both to exist).
 */
import { describe, expect, it, vi } from "vitest";
import BN from "bn.js";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { buildCancelIxs, buildWithdrawIxs, cancelOrderParams, seatSweepIxs, WITHDRAW_ALL_PARAMS } from "./manage";

const SIDE = { Bid: 0, Ask: 1 } as const;
const trader = Keypair.generate().publicKey;
const baseMint = Keypair.generate().publicKey;
const quoteMint = Keypair.generate().publicKey;
const PROGRAM = Keypair.generate().publicKey;
const ix = (tag: string) => new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.from(tag) });

function fakeMarketState() {
  return {
    data: { header: { baseParams: { mintKey: baseMint }, quoteParams: { mintKey: quoteMint } } },
    createCancelMultipleOrdersByIdInstruction: vi.fn(() => ix("cancel")),
    createWithdrawFundsInstruction: vi.fn(() => ix("withdraw")),
  };
}

describe("cancelOrderParams", () => {
  it("maps our orders to SDK CancelOrderParams with the raw u64 OrderId", () => {
    const p = cancelOrderParams(
      [
        { side: "bid", priceInTicks: "45", orderSequenceNumber: "18446744073709551610" },
        { side: "ask", priceInTicks: "60", orderSequenceNumber: "12" },
      ],
      SIDE,
    );
    expect(p.map((o) => [o.side, o.priceInTicks.toString(), o.orderSequenceNumber.toString()])).toEqual([
      [0, "45", "18446744073709551610"],
      [1, "60", "12"],
    ]);
    expect(BN.isBN(p[0].orderSequenceNumber)).toBe(true);
  });
});

describe("withdraw-all params", () => {
  it("null lots = withdraw everything free", () => {
    expect(WITHDRAW_ALL_PARAMS).toEqual({ withdrawFundsParams: { quoteLotsToWithdraw: null, baseLotsToWithdraw: null } });
  });
});

describe("buildCancelIxs / buildWithdrawIxs", () => {
  const ataBase = getAssociatedTokenAddressSync(baseMint, trader).toBase58();
  const ataQuote = getAssociatedTokenAddressSync(quoteMint, trader).toBase58();
  const ataTargets = (ixs: TransactionInstruction[]) =>
    ixs.filter((i) => i.data.toString() !== "cancel" && i.data.toString() !== "withdraw").map((i) => i.keys[1].pubkey.toBase58());

  it("cancel → ATAs, cancel-by-id, withdraw-all (in that order)", () => {
    const ms = fakeMarketState();
    const ixs = buildCancelIxs(ms as never, trader, [{ side: "bid", priceInTicks: "45", orderSequenceNumber: "7" }], SIDE);
    expect(ixs.map((i) => i.data.toString()).slice(-2)).toEqual(["cancel", "withdraw"]);
    expect(ataTargets(ixs)).toEqual([ataBase, ataQuote]);
    const [args, who] = ms.createCancelMultipleOrdersByIdInstruction.mock.calls[0] as unknown as [
      { params: { orders: { side: number }[] } },
      unknown,
    ];
    expect(args.params.orders).toHaveLength(1);
    expect(who).toBe(trader);
    expect(ms.createWithdrawFundsInstruction).toHaveBeenCalledWith(WITHDRAW_ALL_PARAMS, trader);
  });

  it("cancel with no orders is refused", () => {
    expect(() => buildCancelIxs(fakeMarketState() as never, trader, [], SIDE)).toThrow(/no orders/i);
  });

  it("withdraw → ATAs then withdraw-all", () => {
    const ms = fakeMarketState();
    const ixs = buildWithdrawIxs(ms as never, trader);
    expect(ixs.map((i) => i.data.toString()).at(-1)).toBe("withdraw");
    expect(ataTargets(ixs)).toEqual([ataBase, ataQuote]);
  });
});

describe("seatSweepIxs — fold seat funds back into the wallet before a new order (DLV-087)", () => {
  // Market orders use Phoenix Swap, which ignores seat balances; so selling 4 Yes that sit in
  // the seat would fail unless they're withdrawn first in the same tx.
  const withTrader = (free: { base: number; quote: number }) => ({
    ...fakeMarketState(),
    data: {
      header: { baseParams: { mintKey: baseMint }, quoteParams: { mintKey: quoteMint } },
      traders: new Map([[trader.toBase58(), { baseLotsFree: new BN(free.base), quoteLotsFree: new BN(free.quote), baseLotsLocked: new BN(0), quoteLotsLocked: new BN(0) }]]),
    },
  });

  it("free Yes or USDC in the seat → one WithdrawFunds(all)", () => {
    expect(seatSweepIxs(withTrader({ base: 4000, quote: 0 }) as never, trader).map((i) => i.data.toString())).toEqual(["withdraw"]);
    expect(seatSweepIxs(withTrader({ base: 0, quote: 1 }) as never, trader)).toHaveLength(1);
  });

  it("empty seat or no seat → nothing", () => {
    expect(seatSweepIxs(withTrader({ base: 0, quote: 0 }) as never, trader)).toEqual([]);
    expect(seatSweepIxs({ ...fakeMarketState(), data: { ...fakeMarketState().data, traders: new Map() } } as never, trader)).toEqual([]);
  });
});

/**
 * L13 (Reviewers, !63): one CancelMultipleOrdersById with every order overflows the 1232-byte tx
 * limit past ~50 orders. Cancel all is chunked into several txs; L14: each is confirmed and a
 * failed or unconfirmed chunk is reported, never shown as success.
 */
import { CANCEL_ORDERS_PER_TX, chunkCancelOrders, submitPhoenixManage } from "./manage";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";

const order = (i: number) => ({ side: (i % 2 ? "bid" : "ask") as "bid" | "ask", priceInTicks: String(40 + (i % 50)), orderSequenceNumber: String(1_000_000 + i) });

describe("L13: chunked Cancel all", () => {
  it("splits orders into chunks of at most CANCEL_ORDERS_PER_TX, preserving order", () => {
    const orders = Array.from({ length: 120 }, (_, i) => order(i));
    const chunks = chunkCancelOrders(orders);
    expect(chunks.length).toBe(Math.ceil(120 / CANCEL_ORDERS_PER_TX));
    expect(chunks.every((c) => c.length <= CANCEL_ORDERS_PER_TX)).toBe(true);
    expect(chunks.flat()).toEqual(orders);
  });

  it("a full chunk fits in one legacy tx (realistic Phoenix account set, 17 bytes/order)", () => {
    const k = () => Keypair.generate().publicKey;
    const phoenix = k(), logAuth = k(), market = k(), baseVault = k(), quoteVault = k();
    const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ata = (m: PublicKey) => getAssociatedTokenAddressSync(m, trader);
    const ms = {
      data: { header: { baseParams: { mintKey: baseMint }, quoteParams: { mintKey: quoteMint } } },
      createCancelMultipleOrdersByIdInstruction: (args: { params: { orders: unknown[] } }) =>
        new TransactionInstruction({
          programId: phoenix,
          keys: [logAuth, market, trader, ata(baseMint), ata(quoteMint), baseVault, quoteVault, tokenProgram].map((pubkey, i) => ({ pubkey, isSigner: i === 2, isWritable: i !== 0 && i !== 7 })),
          data: Buffer.alloc(1 + 4 + 17 * args.params.orders.length),
        }),
      createWithdrawFundsInstruction: () =>
        new TransactionInstruction({
          programId: phoenix,
          keys: [logAuth, market, trader, ata(baseMint), ata(quoteMint), baseVault, quoteVault, tokenProgram].map((pubkey, i) => ({ pubkey, isSigner: i === 2, isWritable: i !== 0 && i !== 7 })),
          data: Buffer.alloc(1 + 2 + 2),
        }),
    };
    const orders = Array.from({ length: CANCEL_ORDERS_PER_TX }, (_, i) => order(i));
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...buildCancelIxs(ms as never, trader, orders, SIDE));
    tx.feePayer = trader;
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    expect(size).toBeLessThanOrEqual(1232);
  });
});
