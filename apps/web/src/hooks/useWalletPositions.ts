"use client";

/**
 * Live Yes/No balances for every listed market in ONE batched RPC read (DLV-074).
 * `getMultipleParsedAccounts` over all Yes+No ATAs (chunked at 100), polled on an
 * interval and paused while the tab is hidden. Returns null when no wallet is
 * connected or before the first read lands — callers keep their old behaviour.
 */
import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { PositionSnapshot } from "@/lib/intents/types";
import {
  chunk,
  planPositionReads,
  positionsFromAccounts,
  type PositionMarketRef,
} from "@/lib/intents/batchPositions";

export function useWalletPositions(
  markets: readonly PositionMarketRef[],
  pollMs = 10_000,
): Map<string, PositionSnapshot> | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<Map<string, PositionSnapshot> | null>(null);

  // Stable identity for the market set so re-renders don't re-plan / re-poll.
  const marketsKey = markets
    .map((m) => `${m.marketId}:${m.yesMint ?? ""}:${m.noMint ?? ""}`)
    .sort()
    .join("|");
  const owner = publicKey?.toBase58() ?? null;

  const plan = useMemo(() => {
    if (!owner) return null;
    const ownerKey = new PublicKey(owner);
    try {
      return planPositionReads(
        marketsKey
          ? marketsKey.split("|").map((s) => {
              const [marketId, yesMint, noMint] = s.split(":");
              return { marketId, yesMint: yesMint || undefined, noMint: noMint || undefined };
            })
          : [],
        (mint) => getAssociatedTokenAddressSync(new PublicKey(mint), ownerKey, true).toBase58(),
      );
    } catch {
      return null;
    }
  }, [owner, marketsKey]);

  useEffect(() => {
    if (!plan) {
      setPositions(null);
      return;
    }
    if (plan.requests.length === 0) {
      setPositions(new Map());
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const parts = await Promise.all(
          chunk(plan.keys).map((keys) =>
            connection.getMultipleParsedAccounts(
              keys.map((k) => new PublicKey(k)),
              { commitment: "confirmed" },
            ),
          ),
        );
        if (!cancelled) {
          setPositions(positionsFromAccounts(plan, parts.flatMap((p) => p.value)));
        }
      } catch {
        // keep last value; next tick retries
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    const onVis = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [connection, plan, pollMs]);

  return positions;
}
