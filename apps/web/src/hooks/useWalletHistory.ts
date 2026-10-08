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

export function useWalletHistory(markets: readonly MarketView[] | undefined, enabled = true) {
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
    queryKey: ["wallet-history", owner, key, connection.rpcEndpoint],
    enabled: enabled && owner != null && markets !== undefined,
    refetchInterval: 30_000,
    staleTime: 10_000,
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
