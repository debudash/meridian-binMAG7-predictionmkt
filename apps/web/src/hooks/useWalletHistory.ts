"use client";

/**
 * Wallet activity from its own transactions (DLV-088). Shared cache for History + trade Fills.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { MarketView } from "@/lib/market/types";
import { buildHistoryIndex } from "@/lib/history/classify";
import { readWalletHistory } from "@/lib/history/readHistory";
import { logChainReadError } from "@/lib/log/chainRead";
import { getPhoenixProgramId } from "@/lib/phoenix/config";
import { getProgramId, getUsdcMint } from "@/lib/solana/config";
import { POLL_MS, refetchWithBackoff } from "@/lib/rpc/pollPolicy";
import { WALLET_HISTORY_KEY } from "@/lib/rpc/refreshAfterOwnTx";

/**
 * pollMs: false = read once (and on refreshAfterOwnTx after own txs, DLV-114), no interval — e.g. the trade
 * page while its Fills tab isn't open (M4). Default 60s (was 30s).
 */
export function useWalletHistory(
  markets: readonly MarketView[] | undefined,
  enabled = true,
  pollMs: number | false = POLL_MS.history,
) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const key = (markets ?? []).map((m) => `${m.marketId}:${m.status}`).sort().join("|");
  const idx = useMemo(
    () =>
      buildHistoryIndex(markets ?? [], {
        usdcMint: getUsdcMint()?.toBase58(),
        meridianProgramId: getProgramId().toBase58(),
        phoenixProgramId: getPhoenixProgramId(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useQuery({
    queryKey: [WALLET_HISTORY_KEY, owner, key, connection.rpcEndpoint],
    enabled: enabled && owner != null && markets !== undefined,
    refetchInterval: pollMs === false ? false : refetchWithBackoff(pollMs),
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      try {
        return await readWalletHistory(connection, publicKey!, markets ?? [], idx);
      } catch (e) {
        logChainReadError("wallet.history", e, { owner });
        throw e;
      }
    },
  });
}
