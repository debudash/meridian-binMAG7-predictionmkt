"use client";

/**
 * Live exposure for every listed market (DLV-074 → DLV-088): wallet Yes/No + Phoenix seat Yes +
 * resting orders, from one batched account read. Returns null while disconnected or before the
 * first read lands — callers keep their old behaviour.
 */
import { useMemo } from "react";
import type { OpenOrdersSnapshot, PositionSnapshot } from "@/lib/intents/types";
import { availabilityInputs } from "@/lib/portfolio/account";
import { accountRefsFor, POLL_MS } from "@/lib/rpc/pollPolicy";
import { walletPositionsLock, type BalancesLock } from "@/lib/intents/cardLock";
import { useWalletAccount } from "./useWalletAccount";

export interface LiveExposure extends PositionSnapshot {
  /** Resting Phoenix orders (resting buys count toward the opposite-side block) */
  openOrders?: OpenOrdersSnapshot;
}

export interface WalletPositions {
  /** null while disconnected or before the first read lands */
  positions: Map<string, LiveExposure> | null;
  /** M5 on cards: connected wallet whose first read is pending / failed → Buy links locked */
  lock: BalancesLock;
}

export function useWalletPositions(
  markets: Parameters<typeof accountRefsFor>[0],
  pollMs: number = POLL_MS.marketsAccount,
): WalletPositions {
  // M4: Phoenix reads only for open markets (settled ones can't be traded); 30s (was 10s).
  const refs = useMemo(() => accountRefsFor(markets), [markets]);
  const { account, connected, loading, error } = useWalletAccount(refs, pollMs);
  const lock = walletPositionsLock({ connected, hasAccount: !!account, loading, error });
  const positions = useMemo(() => {
    if (!account) return null;
    const out = new Map<string, LiveExposure>();
    for (const [id, state] of account.markets) {
      const { position, openOrders } = availabilityInputs(state);
      out.set(id, { ...position, openOrders });
    }
    return out;
  }, [account]);
  return { positions, lock };
}
