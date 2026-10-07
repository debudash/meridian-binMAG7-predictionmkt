"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buildFixtureMarkets } from "@/lib/market/fixtures";
import { SettlementCountdown } from "@/components/market/SettlementCountdown";
import { RedeemButton, type RedeemableRow } from "@/components/portfolio/RedeemButton";
import { useChainClock } from "@/components/providers/AppProviders";
import {
  getDemoPortfolioSummary,
  listDemoOpenOrdersAcrossMarkets,
  listDemoPositions,
} from "@/lib/demo/portfolio";
import { Suspense } from "react";

type Tab = "positions" | "orders" | "redeemable";

function PortfolioInner() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { nowSec } = useChainClock();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const initialTab: Tab =
    tabParam === "orders" || tabParam === "redeemable" || tabParam === "positions"
      ? tabParam
      : "positions";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    if (tabParam === "orders" || tabParam === "redeemable" || tabParam === "positions") {
      setTab(tabParam);
    }
  }, [tabParam]);

  function setTabAndUrl(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "positions") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const demo = useMemo(() => {
    const markets = buildFixtureMarkets(nowSec);
    const byId = new Map(markets.map((m) => [m.marketId, m]));
    const openPos = listDemoPositions()
      .map((p) => {
        const market = byId.get(p.marketId);
        if (!market || market.status !== "open") return null;
        return { market, side: p.side, size: p.side === "yes" ? p.yesQty : p.noQty, avgEntry: p.avgEntry };
      })
      .filter(Boolean) as {
      market: (typeof markets)[0];
      side: "yes" | "no";
      size: number;
      avgEntry: number;
    }[];

    const redeemable: RedeemableRow[] = markets
      .filter((m) => m.status === "settled-yes" || m.status === "settled-no")
      .map((m) => ({
        marketId: m.marketId,
        label: m.question,
        side: m.status === "settled-yes" ? "yes" : "no",
        size: 25,
        payoutUsdc: 25,
      }));

    const summary = getDemoPortfolioSummary();
    let unrealized = 0;
    let positionsValue = 0;
    for (const p of openPos) {
      const markRaw = p.market.yesMid ?? p.market.lastYes ?? p.avgEntry;
      const mark = p.side === "yes" ? markRaw : 1 - markRaw;
      positionsValue += p.size * mark;
      unrealized += p.size * (mark - p.avgEntry);
    }
    const portfolioValue = positionsValue + summary.usdcAvailable;

    return {
      openPos,
      redeemable,
      orders: listDemoOpenOrdersAcrossMarkets(),
      summary: {
        ...summary,
        unrealized,
        positionsValue,
        portfolioValue,
      },
    };
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <SummaryTile label="Portfolio value" value={`${demo.summary.portfolioValue.toFixed(2)} USDC`} />
          <SummaryTile label="USDC available" value={`${demo.summary.usdcAvailable.toFixed(2)} USDC`} />
          <SummaryTile
            label="Unrealized P&L"
            value={`${demo.summary.unrealized >= 0 ? "+" : ""}${demo.summary.unrealized.toFixed(2)} USDC`}
            accent={demo.summary.unrealized >= 0 ? "var(--green)" : "var(--red)"}
          />
          <SummaryTile
            label="Redeemable now"
            value={`${demo.redeemable.reduce((s, r) => s + r.payoutUsdc, 0).toFixed(2)} USDC`}
          />
          <SummaryTile
            label="Unsettled Phoenix"
            value={`${demo.summary.unsettledPhoenixUsdc.toFixed(2)} USDC`}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {demo.redeemable.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTabAndUrl("redeemable")}
            >
              Redeem all
            </button>
          )}
          {demo.summary.unsettledPhoenixUsdc > 0 && (
            <button
              type="button"
              className="btn"
              title="TODO(phoenix): settleFunds"
              onClick={() => undefined}
            >
              Settle funds
            </button>
          )}
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginBottom: 0, marginTop: 10 }}>
          Demo fixtures until indexer + token account reads (TODO(schema) / INDEXER_URL).
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
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
            onClick={() => setTabAndUrl(id)}
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
              const markRaw = p.market.yesMid ?? 0.5;
              const mark = p.side === "yes" ? markRaw : 1 - markRaw;
              const value = p.size * mark;
              const pnl = p.size * (mark - p.avgEntry);
              return (
                <div key={p.market.marketId} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <Link href={`/markets/${p.market.marketId}`}>{p.market.question}</Link>
                      <div style={{ marginTop: 6 }}>
                        <span className={`chip ${p.side === "yes" ? "chip-yes" : "chip-no"}`}>
                          {p.side.toUpperCase()}
                        </span>{" "}
                        <span className="tabular">{p.size}</span>
                      </div>
                      <div className="muted tabular" style={{ fontSize: "0.85rem", marginTop: 6 }}>
                        Avg {p.avgEntry.toFixed(2)} · Mark {mark.toFixed(2)} · Value{" "}
                        {value.toFixed(2)} USDC · P&amp;L {pnl >= 0 ? "+" : ""}
                        {pnl.toFixed(2)} · Payout if right {(p.size * 1).toFixed(2)}
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
                    <Link className="btn" href={`/markets/${p.market.marketId}?side=${p.side}`}>
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
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          {demo.orders.length === 0 ? (
            <p style={{ margin: "1rem" }}>
              No open orders. TODO(phoenix): list Phoenix trader state per market.
            </p>
          ) : (
            <table className="markets-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Intent</th>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Filled</th>
                </tr>
              </thead>
              <tbody>
                {demo.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/markets/${o.marketId}`}>{o.marketLabel}</Link>
                    </td>
                    <td>{o.intent}</td>
                    <td className="tabular">{o.price.toFixed(2)}</td>
                    <td className="tabular">{o.size}</td>
                    <td className="tabular">{o.filled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.8rem" }}>
        {label}
      </div>
      <div
        className="tabular"
        style={{ fontSize: "1.05rem", fontWeight: 650, color: accent }}
      >
        {value}
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="container">Loading portfolio…</div>}>
      <PortfolioInner />
    </Suspense>
  );
}
