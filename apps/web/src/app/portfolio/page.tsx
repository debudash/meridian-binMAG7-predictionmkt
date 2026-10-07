"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buildFixtureMarkets } from "@/lib/market/fixtures";
import { SettlementCountdown } from "@/components/market/SettlementCountdown";
import { RedeemButton, type RedeemableRow } from "@/components/portfolio/RedeemButton";
import { useChainClock } from "@/components/providers/AppProviders";

type Tab = "positions" | "orders" | "redeemable";

export default function PortfolioPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { nowSec } = useChainClock();
  const [tab, setTab] = useState<Tab>("positions");

  // Fixture demo positions — real balances require indexer / token accounts (TODO(schema))
  const demo = useMemo(() => {
    const markets = buildFixtureMarkets(nowSec);
    const openPos = markets
      .filter((m) => m.status === "open")
      .slice(0, 1)
      .map((m) => ({
        market: m,
        side: "yes" as const,
        size: 40,
        avgEntry: 0.62,
      }));
    const redeemable: RedeemableRow[] = markets
      .filter((m) => m.status === "settled-yes" || m.status === "settled-no")
      .map((m) => ({
        marketId: m.marketId,
        label: m.question,
        side: m.status === "settled-yes" ? "yes" : "no",
        size: 25,
        payoutUsdc: 25,
        // No on-chain accounts for fixtures — RedeemButton explains stub
      }));
    return { openPos, redeemable };
  }, [nowSec]);

  if (!connected) {
    return (
      <div className="container">
        <h1>Portfolio</h1>
        <div className="card" style={{ maxWidth: 480 }}>
          <p style={{ marginTop: 0 }}>Connect a wallet to see your positions.</p>
          <button type="button" className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Portfolio</h1>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="grid-2" style={{ gap: "0.75rem" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Positions (demo fixtures)
            </div>
            <div className="tabular" style={{ fontSize: "1.2rem", fontWeight: 650 }}>
              {demo.openPos.length}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              Redeemable now
            </div>
            <div className="tabular" style={{ fontSize: "1.2rem", fontWeight: 650 }}>
              {demo.redeemable
                .reduce((s, r) => s + r.payoutUsdc, 0)
                .toFixed(2)}{" "}
              USDC
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0 }}>
          Cost basis / live balances require indexer + token account reads (TODO(schema) /
          INDEXER_URL). Demo rows below exercise UI + redeem builder.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(
          [
            ["positions", "Positions"],
            ["orders", "Open orders"],
            ["redeemable", `Redeemable (${demo.redeemable.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <Link className="btn" href="/history">
          History
        </Link>
      </div>

      {tab === "positions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {demo.openPos.length === 0 ? (
            <div className="card">
              No open positions. <Link href="/markets">Browse markets</Link>
            </div>
          ) : (
            demo.openPos.map((p) => {
              const mark = p.market.yesMid ?? 0.5;
              const value = p.size * mark;
              const pnl = p.size * (mark - p.avgEntry);
              return (
                <div key={p.market.marketId} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <Link href={`/markets/${p.market.marketId}`}>{p.market.question}</Link>
                      <div style={{ marginTop: 6 }}>
                        <span className="chip chip-yes">{p.side.toUpperCase()}</span>{" "}
                        <span className="tabular">{p.size}</span>
                      </div>
                      <div className="muted tabular" style={{ fontSize: "0.85rem", marginTop: 6 }}>
                        Avg {p.avgEntry.toFixed(2)} · Mark {mark.toFixed(2)} · Value{" "}
                        {value.toFixed(2)} USDC · P&amp;L {pnl >= 0 ? "+" : ""}
                        {pnl.toFixed(2)}
                      </div>
                    </div>
                    <SettlementCountdown market={p.market} compact />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <Link
                      className="btn"
                      href={`/markets/${p.market.marketId}?side=${p.side}&intent=sell-${p.side}`}
                    >
                      Sell all
                    </Link>
                    <Link className="btn" href={`/markets/${p.market.marketId}`}>
                      Trade
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="card">
          <p style={{ margin: 0 }}>
            No open orders. TODO(phoenix): list Phoenix trader state per market.
          </p>
        </div>
      )}

      {tab === "redeemable" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {demo.redeemable.length === 0 ? (
            <div className="card">Nothing to redeem.</div>
          ) : (
            demo.redeemable.map((r) => (
              <div
                key={r.marketId}
                className="card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div>{r.label}</div>
                  <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                    Settled {r.side === "yes" ? "Yes" : "No"} · {r.size} contracts ·{" "}
                    {r.payoutUsdc.toFixed(2)} USDC
                  </div>
                </div>
                <RedeemButton row={r} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
