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
