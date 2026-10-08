"use client";

/**
 * One market's live account state for the trade page (replaces useLivePosition):
 * wallet Yes/No/USDC + Phoenix seat + resting orders → availability inputs. DLV-088 / DLV-087
 */
import { useMemo } from "react";
import type { MarketView } from "@/lib/market/types";
import { availabilityInputs, labelOrders, type LabelledOrder, type MarketAccountState } from "@/lib/portfolio/account";
import type { OpenOrdersSnapshot, PositionSnapshot } from "@/lib/intents/types";
import { useWalletAccount } from "./useWalletAccount";

export interface MarketAccount {
  state: MarketAccountState | null;
  position: PositionSnapshot | null;
  openOrders: OpenOrdersSnapshot | null;
  orders: LabelledOrder[];
  usdc: number | undefined;
  loading: boolean;
  error: string | null;
  connected: boolean;
  refresh: () => void;
}

export function useMarketAccount(
  market: Pick<MarketView, "marketId" | "yesMint" | "noMint" | "phoenixMarket">,
  pollMs = 4_000,
): MarketAccount {
  const refs = useMemo(
    () => [{ marketId: market.marketId, yesMint: market.yesMint, noMint: market.noMint, phoenixMarket: market.phoenixMarket }],
    [market.marketId, market.yesMint, market.noMint, market.phoenixMarket],
  );
  const { account, error, loading, connected, refresh } = useWalletAccount(refs, pollMs);
  return useMemo(() => {
    const state = account?.markets.get(market.marketId) ?? null;
    const inputs = state ? availabilityInputs(state) : null;
    return {
      state,
      position: inputs?.position ?? null,
      openOrders: inputs?.openOrders ?? null,
      orders: state ? labelOrders(state) : [],
      usdc: account?.usdc ?? undefined,
      loading,
      error,
      connected,
      refresh,
    };
  }, [account, market.marketId, loading, error, connected, refresh]);
}
