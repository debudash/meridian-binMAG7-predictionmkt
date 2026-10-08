"use client";

/**
 * Live underlying price for a market from the account `StrikeMarket.pyth_price_feed`
 * points at (mock Pyth on localnet, Pyth on devnet/mainnet). Polls RPC; pauses
 * while the tab is hidden. Falls back to the SSR value on MarketView, else null → "—".
 */
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import { decodePythPriceAccount, type PythPriceSource } from "@/lib/pyth/priceAccount";
import { logChainReadError } from "@/lib/log/chainRead";

export interface UnderlyingQuote {
  price: number;
  source: PythPriceSource | "indexer";
  publishSlot?: number;
  publishTime?: number;
}

export function useUnderlyingPrice(
  market: Pick<MarketView, "pythFeedId" | "underlyingPrice" | "underlyingPublishTs">,
  pollMs = 5000,
): UnderlyingQuote | null {
  const { connection } = useConnection();
  const fallback: UnderlyingQuote | null =
    market.underlyingPrice != null
      ? { price: market.underlyingPrice, source: "indexer", publishTime: market.underlyingPublishTs }
      : null;
  const [quote, setQuote] = useState<UnderlyingQuote | null>(fallback);

  useEffect(() => {
    let key: PublicKey | null = null;
    try {
      key = market.pythFeedId ? new PublicKey(market.pythFeedId) : null;
    } catch {
      key = null;
    }
    if (!key) return;
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const info = await connection.getAccountInfo(key!, "confirmed");
        const d = decodePythPriceAccount(info?.data);
        if (!cancelled && d) {
          setQuote({
            price: d.price,
            source: d.source,
            publishSlot: d.publishSlot,
            publishTime: d.publishTime,
          });
        }
      } catch (e) {
        // keep last value
        logChainReadError("pyth.underlying", e, { feed: market.pythFeedId });
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connection, market.pythFeedId, pollMs]);

  return quote;
}
