"use client";

/**
 * Portfolio for the connected wallet (DLV-088): market list (/api/markets) + one batched account
 * read → positions, resting orders, Phoenix seat balances, redeemable. Demo data only in
 * localnet fixture mode (the market list itself is fixtures on a localnet-style cluster).
 */
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { buildFixtureMarkets } from "@/lib/market/fixtures";
import type { MarketView } from "@/lib/market/types";
import { buildPortfolio, type Portfolio } from "@/lib/portfolio/account";
import { demoAccountAllowed } from "@/lib/portfolio/demoMode";
import { buildDemoPortfolio } from "@/lib/demo/portfolio";
import { useMarketList } from "./useMarketList";
import { useWalletAccount } from "./useWalletAccount";

export interface UsePortfolioResult {
  portfolio: Portfolio | null;
  markets: MarketView[] | undefined;
  demo: boolean;
  loading: boolean;
  /** Market list or account read failed (logged) */
  error: string | null;
  connected: boolean;
}

export function usePortfolio(nowSec: number, pollMs = 15_000): UsePortfolioResult {
  const { connected } = useWallet();
  const list = useMarketList();
  const markets = list.data?.markets;
  const demo = list.data ? demoAccountAllowed({ usedFixtures: list.data.usedFixtures }) : false;
  const acct = useWalletAccount(demo ? [] : markets ?? [], pollMs);
  const portfolio = useMemo(() => {
    if (!connected || !list.data) return null;
    if (demo) return buildDemoPortfolio(buildFixtureMarkets(nowSec));
    if (!acct.account) return null;
    return buildPortfolio(list.data.markets, acct.account.markets, acct.account.usdc);
    // nowSec only matters for demo fixtures; avoid recomputing live portfolios every second
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, list.data, demo, acct.account, demo ? nowSec : 0]);
  const listError = list.data?.error ?? (list.error ? String(list.error) : null);
  return {
    portfolio,
    markets,
    demo,
    loading: connected && (list.isLoading || (!demo && !!markets && markets.length > 0 && acct.loading)),
    error: listError ?? acct.error,
    connected,
  };
}
