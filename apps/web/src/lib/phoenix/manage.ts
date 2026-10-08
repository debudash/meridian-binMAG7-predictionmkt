/**
 * Phoenix seat management (DLV-087): cancel resting orders, withdraw the trader account.
 *
 * Phoenix credits a maker's fills to its seat on the market, not the wallet. Cancel uses
 * CancelMultipleOrdersById with the raw on-chain OrderId and then WithdrawFunds(all), so
 * cancelling also sweeps any filled / released funds back to the wallet in the same tx.
 * Withdraw = WithdrawFunds(all free); locked funds stay behind their resting orders.
 */
import BN from "bn.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { PhoenixOpenOrder } from "@/lib/portfolio/phoenixTrader";
import { confirmSignature, type ConfirmOutcome } from "@/lib/solana/confirm";

type OrderRef = Pick<PhoenixOpenOrder, "side" | "priceInTicks" | "orderSequenceNumber">;
type SideEnum = { Bid: number; Ask: number };

/** Minimal slice of the SDK MarketState these builders use. */
export interface ManageMarketState {
  data: { header: { baseParams: { mintKey: PublicKey }; quoteParams: { mintKey: PublicKey } } };
  createCancelMultipleOrdersByIdInstruction(
    args: { params: { orders: { side: number; priceInTicks: BN; orderSequenceNumber: BN }[] } },
    trader: PublicKey,
  ): TransactionInstruction;
  createWithdrawFundsInstruction(
    args: typeof WITHDRAW_ALL_PARAMS,
    trader: PublicKey,
  ): TransactionInstruction;
}

export const WITHDRAW_ALL_PARAMS = {
  withdrawFundsParams: { quoteLotsToWithdraw: null, baseLotsToWithdraw: null },
} as const;

export function cancelOrderParams(orders: readonly OrderRef[], Side: SideEnum) {
  return orders.map((o) => ({
    side: o.side === "bid" ? Side.Bid : Side.Ask,
    priceInTicks: new BN(o.priceInTicks, 10),
    orderSequenceNumber: new BN(o.orderSequenceNumber, 10),
  }));
}

function ataIxs(ms: ManageMarketState, trader: PublicKey): TransactionInstruction[] {
  return [ms.data.header.baseParams.mintKey, ms.data.header.quoteParams.mintKey].map((mint) =>
    createAssociatedTokenAccountIdempotentInstruction(
      trader,
      getAssociatedTokenAddressSync(mint, trader),
      trader,
      mint,
    ),
  );
}

export function buildWithdrawIxs(ms: ManageMarketState, trader: PublicKey): TransactionInstruction[] {
  return [...ataIxs(ms, trader), ms.createWithdrawFundsInstruction(WITHDRAW_ALL_PARAMS, trader)];
}

export function buildCancelIxs(
  ms: ManageMarketState,
  trader: PublicKey,
  orders: readonly OrderRef[],
  Side: SideEnum,
): TransactionInstruction[] {
  if (orders.length === 0) throw new Error("No orders to cancel");
  return [
    ...ataIxs(ms, trader),
    ms.createCancelMultipleOrdersByIdInstruction({ params: { orders: cancelOrderParams(orders, Side) } }, trader),
    ms.createWithdrawFundsInstruction(WITHDRAW_ALL_PARAMS, trader),
  ];
}

export interface ManageContext {
  connection: Connection;
  publicKey: PublicKey;
  sendTransaction: (tx: Transaction, connection: Connection, opts?: { skipPreflight?: boolean }) => Promise<string>;
}

export type ManageAction = { kind: "cancel"; orders: readonly OrderRef[] } | { kind: "withdraw" };

export interface ManageResult {
  ok: boolean;
  /** Last signature sent (if any) */
  signature?: string;
  /** Every signature sent, in order (Cancel all may need several txs — L13) */
  signatures?: string[];
  /** L14: confirmed on-chain / landed with an error / couldn't confirm / never sent */
  status: ConfirmOutcome["status"] | "not-sent";
  message: string;
}

/**
 * L13: orders per CancelMultipleOrdersById tx. 17 bytes/order; 20 leaves ample room under the
 * 1232-byte legacy tx limit next to the CU ix, two idempotent ATA ixs and WithdrawFunds.
 */
export const CANCEL_ORDERS_PER_TX = 20;

export function chunkCancelOrders<T>(orders: readonly T[], size = CANCEL_ORDERS_PER_TX): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < orders.length; i += size) out.push(orders.slice(i, i + size));
  return out;
}

const plural = (n: number) => `${n} order${n === 1 ? "" : "s"}`;

/**
 * Load the market, build, sign + send, then confirm each tx (L14). Cancel all is chunked into
 * several txs (L13); a chunk that fails or can't be confirmed stops the run and is reported.
 * Never throws; returns a user-facing message.
 */
export async function submitPhoenixManage(
  phoenixMarket: string,
  action: ManageAction,
  ctx: ManageContext & { connection: Pick<Connection, "getLatestBlockhash" | "confirmTransaction"> },
): Promise<ManageResult> {
  const signatures: string[] = [];
  let done = 0;
  try {
    const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
    const address = new PublicKey(phoenixMarket);
    const ms = (await PhoenixSdk.MarketState.loadFromAddress({
      connection: ctx.connection as Connection,
      address,
    })) as unknown as ManageMarketState;
    const batches: { ixs: TransactionInstruction[]; count: number }[] =
      action.kind === "cancel"
        ? chunkCancelOrders(action.orders).map((orders) => ({
            ixs: buildCancelIxs(ms, ctx.publicKey, orders, PhoenixSdk.Side as unknown as SideEnum),
            count: orders.length,
          }))
        : [{ ixs: buildWithdrawIxs(ms, ctx.publicKey), count: 0 }];
    if (batches.length === 0) throw new Error("No orders to cancel");
    const total = action.kind === "cancel" ? action.orders.length : 0;
    for (const batch of batches) {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...batch.ixs);
      tx.feePayer = ctx.publicKey;
      const bh = await ctx.connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = bh.blockhash;
      const signature = await ctx.sendTransaction(tx, ctx.connection as Connection, { skipPreflight: false });
      signatures.push(signature);
      const outcome = await confirmSignature(ctx.connection, signature, bh);
      if (outcome.status !== "confirmed") {
        const what =
          action.kind === "cancel"
            ? done > 0
              ? `Cancelled ${done} of ${total} orders, then a cancel tx ${outcome.status === "failed" ? "failed on-chain" : "wasn't confirmed"}`
              : `Cancel ${outcome.status === "failed" ? "failed on-chain" : "wasn't confirmed"}`
            : `Withdraw ${outcome.status === "failed" ? "failed on-chain" : "wasn't confirmed"}`;
        return {
          ok: false,
          signature,
          signatures,
          status: outcome.status,
          message:
            outcome.status === "failed"
              ? `${what}: ${outcome.error.slice(0, 160)}`
              : `${what} — check the explorer before retrying.`,
        };
      }
      done += batch.count;
    }
    return {
      ok: true,
      signature: signatures[signatures.length - 1],
      signatures,
      status: "confirmed",
      message:
        action.kind === "cancel"
          ? `Cancelled ${plural(total)}${signatures.length > 1 ? ` in ${signatures.length} transactions` : ""}; funds returned to your wallet.`
          : "Withdrew your Phoenix balance to your wallet.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rejected = /reject|denied|User rejected/i.test(msg);
    const prefix =
      action.kind === "cancel" && done > 0
        ? `Cancelled ${done} of ${action.orders.length} orders; the rest `
        : "";
    if (rejected) {
      return { ok: false, signatures, status: "not-sent", message: prefix ? `${prefix}were not sent (wallet rejected).` : "Wallet rejected the transaction." };
    }
    return {
      ok: false,
      signatures,
      status: "not-sent",
      message: prefix ? `${prefix}failed: ${msg}` : `${action.kind === "cancel" ? "Cancel" : "Withdraw"} failed: ${msg}`,
    };
  }
}

type Lots = number | { toString(): string };

/**
 * WithdrawFunds(all) when this trader's seat holds free Yes or USDC — prepended to new orders so
 * seat balances (e.g. resting-buy fills) are usable: Phoenix Swap (market orders) ignores the seat.
 */
export function seatSweepIxs(
  ms: ManageMarketState & { data: { traders?: Map<string, { baseLotsFree: Lots; quoteLotsFree: Lots }> } },
  trader: PublicKey,
): TransactionInstruction[] {
  const t = ms.data.traders?.get(trader.toBase58());
  if (!t) return [];
  const free = Number(t.baseLotsFree.toString()) + Number(t.quoteLotsFree.toString());
  return free > 0 ? [ms.createWithdrawFundsInstruction(WITHDRAW_ALL_PARAMS, trader)] : [];
}
