"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { SettlementCountdown } from "@/components/market/SettlementCountdown";
import { RedeemButton } from "@/components/portfolio/RedeemButton";
import { CancelOrdersButton, WithdrawSeatButton } from "@/components/portfolio/PhoenixActions";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSolBalance } from "@/hooks/useSolBalance";
import { formatSol, solIsLow } from "@/lib/portfolio/solBalance";
import { useChainClock } from "@/components/providers/AppProviders";
import { Suspense, type KeyboardEvent } from "react";
import { onTablistKeyDown, selectableRowProps, tabProps } from "@/components/ui/a11y";
import { isActivationKey, toggleSelection } from "@/lib/ui/selection";

type Tab = "positions" | "orders" | "balances" | "redeemable";
const TABS: readonly Tab[] = ["positions", "orders", "balances", "redeemable"];
const asTab = (v: string | null | undefined): Tab | null => (v && (TABS as readonly string[]).includes(v) ? (v as Tab) : null);

function PortfolioInner() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { nowSec } = useChainClock();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const initialTab: Tab = asTab(tabParam) ?? "positions";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((c) => toggleSelection(c, id));
  /** Card-level selection (cards hold links/buttons, so aria-current + .is-selected, not option). */
  const cardSelectProps = (id: string) => ({
    className: `card selectable${selected === id ? " is-selected" : ""}`,
    "aria-current": selected === id ? ("true" as const) : undefined,
    tabIndex: 0,
    onClick: (e: { target: EventTarget | null }) => {
      if ((e.target as HTMLElement | null)?.closest?.("a,button")) return;
      toggle(id);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || !isActivationKey(e.key)) return;
      e.preventDefault();
      toggle(id);
    },
  });

  useEffect(() => {
    const t = asTab(tabParam);
    if (t) setTab(t);
  }, [tabParam]);

  function setTabAndUrl(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "positions") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const { portfolio, demo, loading, error } = usePortfolio(nowSec);
  const solLamports = useSolBalance();

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

  const p = portfolio;
  const seatYesTotal = p ? p.seats.reduce((s, r) => s + r.yesFree, 0) : 0;
  const seatUsdcTotal = p ? p.totals.seatUsdcFree : 0;
  const withdrawable = p ? p.seats.filter((r) => r.yesFree > 0 || r.usdcFree > 0) : [];
  const portfolioValue = p ? p.totals.positionsValue + (p.totals.usdc ?? 0) + seatUsdcTotal + p.totals.redeemableUsdc : 0;
  const fmt = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)} USDC`);

  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>Portfolio</h1>
      {error && (
        <div className="banner banner-danger" role="alert" style={{ marginBottom: "0.75rem" }}>
          Couldn&apos;t read some on-chain balances: {error}. Showing what loaded; retrying.
        </div>
      )}
      <div className="card" style={{ marginBottom: "0.75rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: "0.6rem",
          }}
        >
          <SummaryTile label="Portfolio value" value={p ? fmt(portfolioValue) : "…"} />
          <SummaryTile label="USDC in wallet" value={p ? fmt(p.totals.usdc) : "…"} />
          <SummaryTile label="Positions (mark)" value={p ? fmt(p.totals.positionsValue) : "…"} />
          <SummaryTile
            label="In Phoenix (withdrawable)"
            value={p ? `${seatUsdcTotal.toFixed(2)} USDC${seatYesTotal > 0 ? ` · ${seatYesTotal} Yes` : ""}` : "…"}
          />
          <SummaryTile label="Redeemable now" value={p ? fmt(p.totals.redeemableUsdc) : "…"} />
          <SummaryTile
            label={solIsLow(solLamports) ? "SOL for fees (low)" : "SOL for fees"}
            value={demo ? "—" : formatSol(solLamports)}
            accent={solIsLow(solLamports) ? "var(--danger)" : undefined}
          />
        </div>
        <p className="muted" style={{ fontSize: "0.78rem", marginBottom: 0, marginTop: 8 }}>
          {demo
            ? "Localnet fixture mode — demo balances, not on-chain."
            : loading && !p
              ? "Reading your on-chain balances…"
              : "On-chain: wallet token accounts + Phoenix trader accounts. Marks use the Yes mid."}
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Portfolio sections" onKeyDown={onTablistKeyDown}>
          {(
            [
              ["positions", `Positions${p?.positions.length ? ` (${p.positions.length})` : ""}`],
              ["orders", `Open orders${p?.orders.length ? ` (${p.orders.length})` : ""}`],
              ["balances", `Phoenix balances${withdrawable.length ? ` (${withdrawable.length})` : ""}`],
              ["redeemable", `Redeemable${p?.redeemable.length ? ` (${p.redeemable.length})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn"
              {...tabProps(tab === id, () => setTabAndUrl(id))}
            >
              {label}
            </button>
          ))}
        </div>
        <Link className="btn" href="/history">
          History
        </Link>
      </div>

      {!p && <div className="card muted">{loading ? "Loading…" : "No data yet."}</div>}

      {p && tab === "positions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {p.positions.length === 0 ? (
            <div className="card">
              No open positions. <Link href="/markets">Browse markets</Link>
            </div>
          ) : (
            p.positions.map((r) => {
              const sellSide = r.side === "no" ? "no" : "yes";
              return (
                <div key={r.market.marketId} {...cardSelectProps(r.market.marketId)} style={{ padding: "0.7rem 0.85rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <Link href={`/markets/${r.market.marketId}`}>{r.market.question}</Link>
                      <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {r.yesQty > 0 && <span className="chip chip-yes tabular">YES {r.yesQty}</span>}
                        {r.noQty > 0 && <span className="chip chip-no tabular">NO {r.noQty}</span>}
                        {r.inSeat > 0 && (
                          <span className="chip chip-amber tabular" title="Filled on Phoenix, still in your trader account">
                            {r.inSeat} Yes in Phoenix
                          </span>
                        )}
                      </div>
                      <div className="muted tabular" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                        Mark {r.mark.toFixed(2)} · Value {r.value.toFixed(2)} USDC · Pays {r.qty.toFixed(2)} if right
                      </div>
                    </div>
                    <SettlementCountdown market={r.market} compact />
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Link
                      className="btn"
                      href={`/markets/${r.market.marketId}?side=${sellSide}&intent=sell-${sellSide}`}
                    >
                      Sell
                    </Link>
                    <Link className="btn" href={`/markets/${r.market.marketId}?side=${sellSide}`}>
                      Trade
                    </Link>
                    {r.inSeat > 0 && r.market.phoenixMarket && !demo && (
                      <WithdrawSeatButton phoenixMarket={r.market.phoenixMarket} compact={false} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {p && tab === "orders" && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          {p.orders.length === 0 ? (
            <p style={{ margin: "1rem" }}>No resting orders on Phoenix.</p>
          ) : (
            <table className="markets-table" role="grid" aria-label="Open orders">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Intent</th>
                  <th>Price</th>
                  <th>Remaining</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {p.orders.map((o) => (
                  <tr key={`${o.market.marketId}:${o.id}`} {...selectableRowProps(selected === o.id, () => toggle(o.id))}>
                    <td>
                      <Link href={`/markets/${o.market.marketId}`}>{o.market.question}</Link>
                    </td>
                    <td>{intentLabel(o.intent)}</td>
                    <td className="tabular">{o.intentPrice.toFixed(2)}</td>
                    <td className="tabular">{o.size}</td>
                    <td>
                      {o.market.phoenixMarket && !demo ? (
                        <CancelOrdersButton phoenixMarket={o.market.phoenixMarket} orders={[o]} />
                      ) : (
                        <span className="muted" style={{ fontSize: "0.78rem" }}>demo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {p && tab === "balances" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {p.seats.length === 0 ? (
            <div className="card">No Phoenix trader accounts yet — one is created with your first limit order.</div>
          ) : (
            p.seats.map((r) => (
              <div
                key={r.phoenixMarket}
                {...cardSelectProps(`seat-${r.phoenixMarket}`)}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "0.7rem 0.85rem" }}
              >
                <div>
                  <Link href={`/markets/${r.market.marketId}`}>{r.market.question}</Link>
                  <div className="muted tabular" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                    Free {r.yesFree} Yes · {r.usdcFree.toFixed(2)} USDC — In orders {r.yesLocked} Yes ·{" "}
                    {r.usdcLocked.toFixed(2)} USDC
                  </div>
                </div>
                {r.yesFree > 0 || r.usdcFree > 0 ? (
                  <WithdrawSeatButton phoenixMarket={r.phoenixMarket} compact={false} />
                ) : (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>Nothing free to withdraw</span>
                )}
              </div>
            ))
          )}
          <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
            Fills of your resting orders land in your Phoenix trader account. New orders sweep it to your
            wallet automatically; Withdraw does it now.
          </p>
        </div>
      )}

      {p && tab === "redeemable" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {p.redeemable.length === 0 ? (
            <div className="card">Nothing to redeem.</div>
          ) : (
            p.redeemable.map((r) => (
              <div
                key={r.marketId}
                {...cardSelectProps(`redeem-${r.marketId}`)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                  padding: "0.7rem 0.85rem",
                }}
              >
                <div>
                  <div>{r.label}</div>
                  <div className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                    Settled {r.side === "yes" ? "Yes" : "No"} · {r.size} contracts · {r.payoutUsdc.toFixed(2)} USDC
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

function intentLabel(intent: string): string {
  return (
    { "buy-yes": "Buy Yes", "buy-no": "Buy No", "sell-yes": "Sell Yes", "sell-no": "Sell No" } as Record<string, string>
  )[intent] ?? intent;
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
