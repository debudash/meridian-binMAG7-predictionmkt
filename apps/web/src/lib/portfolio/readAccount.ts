/**
 * Batched on-chain read of a wallet's Meridian account state (DLV-088 / DLV-087).
 *
 *   1. getMultipleParsedAccounts over every market's Yes + No ATA (+ the USDC ATA), ≤100/call
 *   2. getMultipleAccountsInfo over the Phoenix market accounts → MarketState → this wallet's
 *      seat balances + resting orders
 *
 * RPC failures reject (the polling hook logs them and keeps the last good value). One
 * undecodable Phoenix account is logged and treated as "no seat" for that market only.
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";
import { chunk, parsedTokenUiAmount } from "@/lib/intents/batchPositions";
import { logChainReadError } from "@/lib/log/chainRead";
import { hasPhoenixMarketPubkey } from "@/lib/phoenix/config";
import type { MarketAccountState } from "./account";
import { extractTraderSnapshot, type PhoenixMarketLike, type PhoenixTraderSnapshot } from "./phoenixTrader";

export interface AccountMarketRef {
  marketId: string;
  yesMint?: string;
  noMint?: string;
  phoenixMarket?: string;
}

export interface WalletAccount {
  owner: string;
  /** Wallet USDC (null when NEXT_PUBLIC_USDC_MINT is unset) */
  usdc: number | null;
  markets: Map<string, MarketAccountState>;
  readAt: number;
}

export type LoadMarketState = (address: PublicKey, data: Buffer) => PhoenixMarketLike;

export interface ReadAccountOptions {
  usdcMint?: PublicKey | null;
  /** Inject for tests; default decodes with @ellipsis-labs/phoenix-sdk MarketState.load */
  loadMarketState?: LoadMarketState;
}

async function defaultLoader(): Promise<LoadMarketState> {
  const { MarketState } = await import("@ellipsis-labs/phoenix-sdk");
  return (address, data) => MarketState.load({ address, buffer: data }) as unknown as PhoenixMarketLike;
}

export async function readWalletAccount(
  connection: Pick<Connection, "getMultipleParsedAccounts" | "getMultipleAccountsInfo">,
  owner: PublicKey,
  markets: readonly AccountMarketRef[],
  opts: ReadAccountOptions = {},
): Promise<WalletAccount> {
  const ownerB58 = owner.toBase58();
  const refs = markets.filter((m, i, all) => m.yesMint && m.noMint && all.findIndex((x) => x.marketId === m.marketId) === i);

  // --- 1. token balances
  const keys: string[] = [];
  const index = new Map<string, number>();
  const idxOf = (mint: PublicKey) => {
    const a = getAssociatedTokenAddressSync(mint, owner, true).toBase58();
    let i = index.get(a);
    if (i == null) {
      i = keys.length;
      keys.push(a);
      index.set(a, i);
    }
    return i;
  };
  const plan = refs.map((m) => ({ m, yes: idxOf(new PublicKey(m.yesMint!)), no: idxOf(new PublicKey(m.noMint!)) }));
  const usdcIdx = opts.usdcMint ? idxOf(opts.usdcMint) : -1;
  const infos: unknown[] = [];
  for (const part of chunk(keys)) {
    const res = await connection.getMultipleParsedAccounts(
      part.map((k) => new PublicKey(k)),
      { commitment: "confirmed" },
    );
    infos.push(...res.value);
  }

  // --- 2. Phoenix trader accounts
  const phoenixRefs = refs.filter((m) => hasPhoenixMarketPubkey(m.phoenixMarket));
  const traders = new Map<string, PhoenixTraderSnapshot | null>();
  const readFailed = new Set<string>(); // L7: requested but unreadable (missing account / decode error)
  if (phoenixRefs.length > 0) {
    const load = opts.loadMarketState ?? (await defaultLoader());
    for (const part of chunk(phoenixRefs)) {
      const accts = await connection.getMultipleAccountsInfo(
        part.map((m) => new PublicKey(m.phoenixMarket!)),
        "confirmed",
      );
      part.forEach((m, j) => {
        const info = accts[j];
        if (!info?.data) {
          traders.set(m.marketId, null);
          readFailed.add(m.marketId);
          return;
        }
        try {
          const state = load(new PublicKey(m.phoenixMarket!), Buffer.from(info.data));
          traders.set(m.marketId, extractTraderSnapshot(state, m.phoenixMarket!, ownerB58));
        } catch (e) {
          logChainReadError("phoenix.traderState", e, { phoenixMarket: m.phoenixMarket });
          traders.set(m.marketId, null);
          readFailed.add(m.marketId);
        }
      });
    }
  }

  const out = new Map<string, MarketAccountState>();
  for (const { m, yes, no } of plan) {
    out.set(m.marketId, {
      marketId: m.marketId,
      wallet: { yes: parsedTokenUiAmount(infos[yes]), no: parsedTokenUiAmount(infos[no]) },
      phoenix: traders.get(m.marketId) ?? null,
      ...(readFailed.has(m.marketId) ? { phoenixReadFailed: true as const } : {}),
    });
  }
  return {
    owner: ownerB58,
    usdc: usdcIdx >= 0 ? parsedTokenUiAmount(infos[usdcIdx]) : null,
    markets: out,
    readAt: Date.now(),
  };
}
