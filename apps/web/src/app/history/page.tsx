"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useChainClock } from "@/components/providers/AppProviders";
import { useMarketList } from "@/hooks/useMarketList";
import { useWalletHistory } from "@/hooks/useWalletHistory";
import { demoAccountAllowed } from "@/lib/portfolio/demoMode";
import {
  HIST_TYPE_FILTERS,
  demoHistoryRows,
  filterHistory,
  historyCsv,
  type HistTypeFilter,
} from "@/lib/history/view";
import { truncateAddress } from "@/lib/format";
import { explorerTx } from "@/lib/solana/config";
import { onTablistKeyDown, selectableRowProps, tabProps } from "@/components/ui/a11y";
import { toggleSelection } from "@/lib/ui/selection";

// re-export truncate for history; explorer helper lives in config
function txUrl(sig: string): string {
  return explorerTx(sig);
}

type HistType = HistTypeFilter;
type SideFilter = "all" | "yes" | "no";

function HistoryInner() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { nowSec } = useChainClock();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [type, setType] = useState<HistType>(
    ((HIST_TYPE_FILTERS as readonly string[]).includes(searchParams?.get("type") ?? "")
      ? searchParams!.get("type")
      : "all") as HistType,
  );
  const [marketQ, setMarketQ] = useState(searchParams?.get("market") ?? "");
  const [side, setSide] = useState<SideFilter>(
    (["all", "yes", "no"].includes(searchParams?.get("side") ?? "")
      ? searchParams!.get("side")
      : "all") as SideFilter,
  );
  const [from, setFrom] = useState(searchParams?.get("from") ?? "");
  const [to, setTo] = useState(searchParams?.get("to") ?? "");
  const [selectedRow, setSelectedRow] = useState<string | null>(null);

  function syncUrl(next: Partial<{ type: string; market: string; side: string; from: string; to: string }>) {
    const params = new URLSearchParams();
    const t = next.type ?? type;
    const m = next.market ?? marketQ;
    const s = next.side ?? side;
    const f = next.from ?? from;
    const tt = next.to ?? to;
    if (t && t !== "all") params.set("type", t);
    if (m) params.set("market", m);
    if (s && s !== "all") params.set("side", s);
    if (f) params.set("from", f);
    if (tt) params.set("to", tt);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const list = useMarketList();
  const demo = list.data ? demoAccountAllowed({ usedFixtures: list.data.usedFixtures }) : false;
  const hist = useWalletHistory(demo ? undefined : list.data?.markets, connected);
  const source = useMemo(
    () => (demo ? demoHistoryRows(nowSec) : hist.data?.rows ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demo, demo ? nowSec : 0, hist.data],
  );
  const rows = useMemo(
    () => filterHistory(source, { type, side, market: marketQ, from, to }),
    [source, type, side, marketQ, from, to],
  );
  const loading = connected && (list.isLoading || (!demo && hist.isLoading));
  const loadError = list.data?.error ?? (hist.error ? String((hist.error as Error).message ?? hist.error) : null);

  function exportCsv() {
    const blob = new Blob([historyCsv(rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meridian-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>History</h1>
        <button type="button" className="btn" onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Activity type"
        onKeyDown={onTablistKeyDown}
        style={{ margin: "1rem 0" }}
      >
        {(
          [
            ["all", "All"],
            ["fills", "Fills"],
            ["orders", "Orders"],
            ["cancels", "Cancels"],
            ["transfers", "Withdraw / mint / merge"],
            ["settlements", "Settlements"],
            ["redemptions", "Redemptions"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            {...tabProps(type === id, () => {
              setType(id);
              syncUrl({ type: id });
            })}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <input
          placeholder="Market / underlying"
          value={marketQ}
          onChange={(e) => {
            setMarketQ(e.target.value);
            syncUrl({ market: e.target.value });
          }}
          style={{
            flex: "1 1 160px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.45rem 0.65rem",
            color: "var(--text)",
          }}
        />
        <select
          aria-label="Side filter"
          value={side}
          onChange={(e) => {
            const v = e.target.value as SideFilter;
            setSide(v);
            syncUrl({ side: v });
          }}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.45rem 0.65rem",
            color: "var(--text)",
          }}
        >
          <option value="all">Side: Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <label className="muted" style={{ fontSize: "0.8rem" }}>
          From{" "}
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              syncUrl({ from: e.target.value });
            }}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.35rem",
              color: "var(--text)",
            }}
          />
        </label>
        <label className="muted" style={{ fontSize: "0.8rem" }}>
          To{" "}
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              syncUrl({ to: e.target.value });
            }}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.35rem",
              color: "var(--text)",
            }}
          />
        </label>
      </div>

      {loadError && (
        <div className="banner banner-danger" role="alert" style={{ marginBottom: "0.75rem" }}>
          Couldn&apos;t load your on-chain activity: {loadError}. Retrying.
        </div>
      )}
      {loading && rows.length === 0 ? (
        <div className="card muted">Reading your transactions…</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            {source.length === 0 ? "No Meridian activity for this wallet yet." : "No activity matches these filters."}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setType("all");
              setMarketQ("");
              setSide("all");
              setFrom("");
              setTo("");
              syncUrl({ type: "all", market: "", side: "all", from: "", to: "" });
            }}
          >
            Clear filters
          </button>
          <Link href="/markets">Browse markets</Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="markets-table" role="grid" aria-label="Activity">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Market</th>
                <th>Intent / Outcome</th>
                <th>Price</th>
                <th>Size</th>
                <th>USDC</th>
                <th>Yes / No</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  {...selectableRowProps(selectedRow === r.id, () =>
                    setSelectedRow((c) => toggleSelection(c, r.id)),
                  )}
                >
                  <td>
                    {new Date(r.ts * 1000).toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </td>
                  <td>{r.type}</td>
                  <td>
                    <Link href={`/markets/${r.marketId}`}>{r.marketLabel}</Link>
                  </td>
                  <td>{r.intent}</td>
                  <td className="tabular">{r.price != null ? r.price.toFixed(2) : "—"}</td>
                  <td className="tabular">{r.size ?? "—"}</td>
                  <td className="tabular">{signedOrDash(r.usdcDelta, 2)}</td>
                  <td className="tabular">
                    {r.yesDelta || r.noDelta
                      ? [r.yesDelta ? `${signedOrDash(r.yesDelta, 0)} Y` : "", r.noDelta ? `${signedOrDash(r.noDelta, 0)} N` : ""]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className="tabular">
                    {r.sig ? (
                      <a href={txUrl(r.sig)} target="_blank" rel="noreferrer">
                        {truncateAddress(r.sig, 4, 4)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "0.75rem", padding: "0.65rem 0.85rem" }}>
            {demo
              ? "Localnet fixture mode — demo history, not on-chain."
              : `From this wallet's last ${hist.data?.scanned ?? 0} transactions${hist.data?.truncated ? " (older activity not shown)" : ""}. Fills of your resting orders appear when you cancel or withdraw.`}{" "}
            CSV: ISO-8601 UTC + America/Chicago.
          </p>
        </div>
      )}
    </div>
  );
}

function signedOrDash(n: number, dp: number): string {
  if (!n) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}`;
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="container">Loading history…</div>}>
      <HistoryInner />
    </Suspense>
  );
}
