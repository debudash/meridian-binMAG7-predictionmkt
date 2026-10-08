"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { POLL_MS } from "@/lib/rpc/pollPolicy";
import { logChainReadError } from "@/lib/log/chainRead";

/** Connected wallet's SOL balance in lamports (null until read / when disconnected). Polls like the portfolio. */
export function useSolBalance(pollMs: number = POLL_MS.portfolioAccount): number | null {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState<number | null>(null);
  useEffect(() => {
    setLamports(null);
    if (!publicKey) return;
    let live = true;
    const read = () =>
      connection
        .getBalance(publicKey, "confirmed")
        .then((l) => live && setLamports(l))
        .catch((e) => logChainReadError("rpc.solBalance", e, { owner: publicKey.toBase58() }));
    read();
    const t = setInterval(() => document.visibilityState === "visible" && read(), pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [connection, publicKey, pollMs]);
  return lamports;
}
