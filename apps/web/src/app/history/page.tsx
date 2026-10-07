"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { buildDemoHistory, type DemoFill } from "@/lib/demo/portfolio";
import { useChainClock } from "@/components/providers/AppProviders";
import { truncateAddress } from "@/lib/format";
import { getExplorerUrl } from "@/lib/solana/config";
import { onTablistKeyDown, selectableRowProps, tabProps } from "@/components/ui/a11y";
import { toggleSelection } from "@/lib/ui/selection";

// re-export truncate for history; explorer helper lives in config
function txUrl(sig: string): string {
  return `${getExplorerUrl()}/tx/${sig}`;
}

type HistType = "all" | "fills" | "settlements" | "redemptions" | "cancels";
type SideFilter = "all" | "yes" | "no";

function HistoryInner() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { nowSec } = useChainClock();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [type, setType] = useState<HistType>(
    (["all", "fills", "settlements", "redemptions", "cancels"].includes(
      searchParams?.get("type") ?? "",
    )
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

  const rows = useMemo(() => {
    let list = buildDemoHistory(nowSec);
    if (type !== "all") {
      const map: Record<Exclude<HistType, "all">, DemoFill["type"]> = {
        fills: "fill",
        settlements: "settlement",
        redemptions: "redemption",
        cancels: "cancel",
      };
      list = list.filter((r) => r.type === map[type]);
    }
    if (side !== "all") list = list.filter((r) => r.side === side);
    if (marketQ.trim()) {
      const n = marketQ.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.marketLabel.toLowerCase().includes(n) ||
          r.marketId.toLowerCase().includes(n),
      );
    }
    if (from) {
      const fromTs = Date.parse(from) / 1000;
      if (Number.isFinite(fromTs)) list = list.filter((r) => r.ts >= fromTs);
    }
    if (to) {
      const toTs = Date.parse(to) / 1000 + 86400;
      if (Number.isFinite(toTs)) list = list.filter((r) => r.ts <= toTs);
    }
    return list.sort((a, b) => b.ts - a.ts);
  }, [nowSec, type, side, marketQ, from, to]);

  function exportCsv() {
    const headers = [
      "time_utc",
      "time_local",
      "type",
      "market",
      "intent_or_outcome",
      "price",
      "size",
      "amount_usdc",
      "fee_usdc",
      "realized_pnl_usdc",
      "side",
      "sig",
    ];
    const lines = rows.map((r) => {
      const utc = new Date(r.ts * 1000).toISOString();
      const local = new Date(r.ts * 1000).toLocaleString("en-US", {
        timeZone: "America/Chicago",
      });
      return [
        utc,
        local,
        r.type,
        r.marketLabel,
        r.intentOrOutcome,
        r.price ?? "",
        r.size,
        r.amountUsdc ?? "",
        r.feeUsdc ?? "",
        r.realizedPnlUsdc ?? "",
        r.side,
        r.sig,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob([[headers.join(","), ...lines].join("\n")], {
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
            ["settlements", "Settlements"],
            ["redemptions", "Redemptions"],
            ["cancels", "Cancels"],
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

      {rows.length === 0 ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>No activity matches these filters.</p>
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
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Fixture history when no indexer. Intent labels for Phoenix fills are TODO(schema).
          </p>
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
                <th>Amount</th>
                <th>Fee</th>
                <th>Realized P&L</th>
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
                  <td>
                    {r.type}
                    {r.makerOrTaker ? ` (${r.makerOrTaker})` : ""}
                  </td>
                  <td>
                    <Link href={`/markets/${r.marketId}`}>{r.marketLabel}</Link>
                  </td>
                  <td>{r.intentOrOutcome}</td>
                  <td className="tabular">
                    {r.price != null ? r.price.toFixed(2) : "—"}
                  </td>
                  <td className="tabular">{r.size}</td>
                  <td className="tabular">
                    {r.amountUsdc != null
                      ? `${r.amountUsdc >= 0 ? "+" : ""}${r.amountUsdc.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="tabular">
                    {r.feeUsdc != null ? r.feeUsdc.toFixed(2) : "—"}
                  </td>
                  <td className="tabular">
                    {r.realizedPnlUsdc != null
                      ? `${r.realizedPnlUsdc >= 0 ? "+" : ""}${r.realizedPnlUsdc.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="tabular">
                    <a href={txUrl(r.sig)} target="_blank" rel="noreferrer">
                      {truncateAddress(r.sig, 4, 4)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "0.75rem", padding: "0.65rem 0.85rem" }}>
            Fixture data (no indexer). CSV uses ISO-8601 UTC + America/Chicago local column.
          </p>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="container">Loading history…</div>}>
      <HistoryInner />
    </Suspense>
  );
}
