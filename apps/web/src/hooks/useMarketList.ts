"use client";

/**
 * Market list for client-only surfaces (Header, Portfolio, History) via /api/markets — the same
 * server indexer as the pages, so fixtures appear only in localnet fixture mode (DLV-084/088).
 */
import { useQuery } from "@tanstack/react-query";
import type { MarketListResult } from "@/lib/indexer/types";
import { logChainReadError } from "@/lib/log/chainRead";
import { POLL_MS, refetchWithBackoff } from "@/lib/rpc/pollPolicy";

export function useMarketList() {
  return useQuery<MarketListResult>({
    queryKey: ["market-list"],
    // M4: the server caches the scan too; clients poll slowly and back off on 429.
    refetchInterval: refetchWithBackoff(POLL_MS.marketList),
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const body = (await res.json()) as MarketListResult;
      if (!res.ok && body.source !== "unavailable") {
        logChainReadError("api.markets", `HTTP ${res.status}`);
      }
      if (body.source === "unavailable") logChainReadError("api.markets", body.error ?? "unavailable");
      return body;
    },
  });
}
