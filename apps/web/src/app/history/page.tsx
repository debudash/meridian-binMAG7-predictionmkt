"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

type HistType = "all" | "fills" | "settlements" | "redemptions" | "cancels";

export default function HistoryPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [type, setType] = useState<HistType>("all");

  if (!connected) {
    return (
      <div className="container">
        <h1>History</h1>
        <div className="card" style={{ maxWidth: 480 }}>
          <p style={{ marginTop: 0 }}>Connect a wallet to see your history.</p>
          <button type="button" className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>History</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        {(
          [
            ["all", "All"],
            ["fills", "Fills"],
            ["settlements", "Settlements"],
            ["redemptions", "Redemptions"],
            ["cancels", "Cancels"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            aria-pressed={type === id}
            onClick={() => setType(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <p style={{ marginTop: 0 }}>No activity yet.</p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Fills / settlements / redemptions require an indexer (
          <code>NEXT_PUBLIC_INDEXER_URL</code>). Intent labels for Phoenix fills are
          TODO(schema). Optimistic pending rows will dedupe by signature when wired.
        </p>
        <Link href="/markets">Browse markets</Link>
      </div>
    </div>
  );
}
