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
  signature?: string;
  message: string;
}

/** Load the market, build, sign + send. Never throws; returns a user-facing message. */
export async function submitPhoenixManage(
  phoenixMarket: string,
  action: ManageAction,
  ctx: ManageContext,
): Promise<ManageResult> {
  try {
    const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
    const address = new PublicKey(phoenixMarket);
    const ms = (await PhoenixSdk.MarketState.loadFromAddress({
      connection: ctx.connection,
      address,
    })) as unknown as ManageMarketState;
    const ixs =
      action.kind === "cancel"
        ? buildCancelIxs(ms, ctx.publicKey, action.orders, PhoenixSdk.Side as unknown as SideEnum)
        : buildWithdrawIxs(ms, ctx.publicKey);
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    tx.feePayer = ctx.publicKey;
    tx.recentBlockhash = (await ctx.connection.getLatestBlockhash("confirmed")).blockhash;
    const signature = await ctx.sendTransaction(tx, ctx.connection, { skipPreflight: false });
    return {
      ok: true,
      signature,
      message:
        action.kind === "cancel"
          ? `Cancelled ${action.orders.length} order${action.orders.length === 1 ? "" : "s"}; funds returned to your wallet.`
          : "Withdrew your Phoenix balance to your wallet.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/reject|denied|User rejected/i.test(msg)) return { ok: false, message: "Wallet rejected the transaction." };
    return { ok: false, message: `${action.kind === "cancel" ? "Cancel" : "Withdraw"} failed: ${msg}` };
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
