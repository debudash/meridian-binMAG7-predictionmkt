"use client";

/**
 * Connected wallet's on-chain account state across markets (DLV-088 / DLV-087):
 * Yes/No/USDC balances + Phoenix seat + resting orders, one batched read per poll.
 * Shared react-query cache (same market set → same key) so Header, Portfolio and the
 * Markets list don't each poll. Errors are logged (DLV-090) and the last good value kept.
 */
import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { logChainReadError } from "@/lib/log/chainRead";
import { readWalletAccount, type AccountMarketRef, type WalletAccount } from "@/lib/portfolio/readAccount";
import { getUsdcMint } from "@/lib/solana/config";
import { refetchWithBackoff } from "@/lib/rpc/pollPolicy";

export { WALLET_ACCOUNT_KEY } from "@/lib/rpc/refreshAfterOwnTx"; // shared with refreshAfterOwnTx (DLV-114)
import { WALLET_ACCOUNT_KEY } from "@/lib/rpc/refreshAfterOwnTx";

export interface UseWalletAccountResult {
  /** undefined until the first read lands (or when disconnected) */
  account: WalletAccount | undefined;
  /** Last read failed (account may still hold the previous good value) */
  error: string | null;
  loading: boolean;
  connected: boolean;
  refresh: () => void;
}

export function marketsKeyOf(markets: readonly AccountMarketRef[]): string {
  return markets
    .filter((m) => m.yesMint && m.noMint)
    .map((m) => `${m.marketId}:${m.yesMint}:${m.noMint}:${m.phoenixMarket ?? ""}`)
    .sort()
    .join("|");
}

export interface UseWalletAccountOptions {
  /**
   * Keep showing the previous read while a changed market set loads. Only safe when the new set
   * is a subset of the old one (Portfolio dropping settled Phoenix books); never for a market
   * switch, where stale data would read as another market's balances.
   */
  keepPrevious?: boolean;
}

export function useWalletAccount(
  markets: readonly AccountMarketRef[],
  pollMs = 10_000,
  opts: UseWalletAccountOptions = {},
): UseWalletAccountResult {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const marketsKey = marketsKeyOf(markets);
  const refs = useMemo<AccountMarketRef[]>(
    () =>
      marketsKey
        ? marketsKey.split("|").map((s) => {
            const [marketId, yesMint, noMint, phoenixMarket] = s.split(":");
            return { marketId, yesMint, noMint, phoenixMarket: phoenixMarket || undefined };
          })
        : [],
    [marketsKey],
  );
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: [WALLET_ACCOUNT_KEY, owner, marketsKey, connection.rpcEndpoint],
    enabled: owner != null,
    refetchInterval: refetchWithBackoff(pollMs), // M4: back off on 429
    refetchIntervalInBackground: false,
    staleTime: Math.min(pollMs, 5_000),
    retry: 1,
    placeholderData: opts.keepPrevious ? keepPreviousData : undefined,
    queryFn: async () => {
      try {
        return await readWalletAccount(connection, publicKey!, refs, { usdcMint: getUsdcMint() });
      } catch (e) {
        logChainReadError("wallet.account", e, { owner, markets: refs.length });
        throw e;
      }
    },
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [WALLET_ACCOUNT_KEY] });
  }, [queryClient]);
  // keepPrevious never leaks another wallet's read across a wallet switch
  const account = owner && q.data?.owner === owner ? q.data : undefined;
  return {
    account,
    error: q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : null,
    loading: owner != null && account === undefined && !q.error,
    connected: owner != null,
    refresh,
  };
}
