"use client";

/**
 * Live Yes/No/USDC wallet balances for a market (polls RPC).
 * Returns null when disconnected or mints unknown → callers fall back to demo/flat.
 */
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import type { PositionSnapshot } from "@/lib/intents/types";
import { getUsdcMint } from "@/lib/solana/config";

export interface LivePosition extends PositionSnapshot {
  usdc: number;
  updatedAt: number;
}

export function useLivePosition(
  market: Pick<MarketView, "yesMint" | "noMint">,
  pollMs = 4000,
): LivePosition | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [pos, setPos] = useState<LivePosition | null>(null);

  useEffect(() => {
    if (!publicKey || !market.yesMint || !market.noMint) {
      setPos(null);
      return;
    }
    let cancelled = false;
    const usdc = getUsdcMint();
    const mints = [new PublicKey(market.yesMint), new PublicKey(market.noMint), usdc];
    const atas = mints.map((m) => (m ? getAssociatedTokenAddressSync(m, publicKey) : null));

    const load = async () => {
      try {
        const keys = atas.filter((a): a is PublicKey => a !== null);
        const infos = await connection.getMultipleParsedAccounts(keys, { commitment: "confirmed" });
        const amt = (i: number) => {
          const v = infos.value[i];
          const data = v?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } | undefined;
          return data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        };
        if (!cancelled) {
          setPos({ yesQty: amt(0), noQty: amt(1), usdc: usdc ? amt(2) : 0, updatedAt: Date.now() });
        }
      } catch {
        // keep last value
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connection, publicKey, market.yesMint, market.noMint, pollMs]);

  return pos;
}
