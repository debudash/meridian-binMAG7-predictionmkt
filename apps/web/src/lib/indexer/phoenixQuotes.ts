/**
 * Top-of-book Yes quotes from Phoenix for market cards / detail.
 *
 * Per-book resilient: the books (plus the Clock sysvar) are read with one batched
 * getMultipleAccountsInfo per ≤99 books, and each book is decoded on its own. A missing account
 * (e.g. a settled market pointing at a book that no longer exists), a failed or undecodable book
 * only leaves THAT card's quote unset ("—"); every other card keeps its live quote.
 *
 * Before this, the SDK's Client.createWithoutConfig threw "Unable to get account data" for the
 * whole batch when one account was null, which blanked every card.
 */
import BN from "bn.js";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  type AccountInfo,
  type Commitment,
} from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import { logChainReadError } from "@/lib/log/chainRead";

/** getMultipleAccountsInfo is capped at 100 keys; one slot is the Clock sysvar. */
const BOOKS_PER_READ = 99;

export interface AccountsReader {
  getMultipleAccountsInfo(
    keys: PublicKey[],
    commitment?: Commitment,
  ): Promise<(AccountInfo<Buffer> | null)[]>;
}

export interface ClockSnapshot {
  slot: BN;
  unixTimestamp: BN;
}

/** Clock sysvar layout: slot u64 · epoch_start_timestamp i64 · epoch u64 · leader_schedule_epoch u64 · unix_timestamp i64. */
export function decodeClockSysvar(data: Buffer | undefined | null): ClockSnapshot | null {
  if (!data || data.length < 40) return null;
  return {
    slot: new BN(data.readBigUInt64LE(0).toString()),
    unixTimestamp: new BN(data.readBigInt64LE(32).toString()),
  };
}

function applyTopOfBook(v: MarketView, bid: number | undefined, ask: number | undefined): void {
  if (bid != null) v.yesBid = bid;
  if (ask != null) v.yesAsk = ask;
  if (bid != null && ask != null) v.yesMid = Math.round(((bid + ask) / 2) * 1000) / 1000;
  else if (bid != null || ask != null) v.yesMid = (bid ?? ask) as number;
}

export async function attachPhoenixQuotes(
  connection: AccountsReader,
  views: MarketView[],
): Promise<void> {
  const withBook: { v: MarketView; key: PublicKey }[] = [];
  for (const v of views) {
    if (!v.phoenixMarket) continue;
    try {
      withBook.push({ v, key: new PublicKey(v.phoenixMarket) });
    } catch {
      // fixture slug, not a pubkey — no book to read
    }
  }
  if (withBook.length === 0) return;

  let PhoenixSdk: typeof import("@ellipsis-labs/phoenix-sdk") | undefined;
  for (let i = 0; i < withBook.length; i += BOOKS_PER_READ) {
    const chunk = withBook.slice(i, i + BOOKS_PER_READ);
    let infos: (AccountInfo<Buffer> | null)[];
    try {
      infos = await connection.getMultipleAccountsInfo(
        [...chunk.map((c) => c.key), SYSVAR_CLOCK_PUBKEY],
        "confirmed",
      );
    } catch (e) {
      // RPC down for this chunk — its quotes stay "—"
      logChainReadError("rpc.phoenix.markets", e, { count: chunk.length });
      continue;
    }
    const clock = decodeClockSysvar(infos[chunk.length]?.data);
    if (!clock) {
      logChainReadError("rpc.phoenix.clock", new Error("Unable to read Clock sysvar"), {
        count: chunk.length,
      });
      continue;
    }
    for (const [j, { v, key }] of chunk.entries()) {
      const data = infos[j]?.data;
      if (!data) {
        logChainReadError("rpc.phoenix.market", new Error("Phoenix market account not found"), {
          phoenixMarket: key.toBase58(),
          marketId: v.marketId,
        });
        continue;
      }
      try {
        PhoenixSdk ??= await import("@ellipsis-labs/phoenix-sdk");
        const state = PhoenixSdk.MarketState.load({ address: key, buffer: data });
        const ladder = state.getUiLadder(1, clock.slot, clock.unixTimestamp);
        applyTopOfBook(v, ladder.bids?.[0]?.price, ladder.asks?.[0]?.price);
      } catch (e) {
        // undecodable / not a Phoenix market — leave this card's quote unset
        logChainReadError("rpc.phoenix.ladder", e, {
          phoenixMarket: key.toBase58(),
          marketId: v.marketId,
        });
      }
    }
  }
}
