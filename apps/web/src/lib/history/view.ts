/**
 * History page helpers (DLV-088): filters, CSV, and the localnet-fixture demo mapping.
 */
import { buildDemoHistory, type DemoFill } from "@/lib/demo/portfolio";
import type { HistoryRow, HistoryType } from "./classify";

export type HistTypeFilter = "all" | "fills" | "orders" | "settlements" | "redemptions" | "cancels" | "transfers";
export const HIST_TYPE_FILTERS: readonly HistTypeFilter[] = [
  "all",
  "fills",
  "orders",
  "settlements",
  "redemptions",
  "cancels",
  "transfers",
];

const GROUP: Record<Exclude<HistTypeFilter, "all">, readonly HistoryType[]> = {
  fills: ["trade"],
  orders: ["order"],
  settlements: ["settlement"],
  redemptions: ["redemption"],
  cancels: ["cancel"],
  transfers: ["withdraw", "mint", "merge"],
};

export interface HistoryFilters {
  type: HistTypeFilter;
  side: "all" | "yes" | "no";
  market: string;
  /** yyyy-mm-dd */
  from: string;
  to: string;
}

export function filterHistory(rows: readonly HistoryRow[], f: HistoryFilters): HistoryRow[] {
  let list = [...rows];
  if (f.type !== "all") {
    const allowed = GROUP[f.type];
    list = list.filter((r) => allowed.includes(r.type));
  }
  if (f.side !== "all") list = list.filter((r) => r.side === f.side);
  const q = f.market.trim().toLowerCase();
  if (q) list = list.filter((r) => r.marketLabel.toLowerCase().includes(q) || r.marketId.toLowerCase().includes(q));
  if (f.from) {
    const t = Date.parse(f.from) / 1000;
    if (Number.isFinite(t)) list = list.filter((r) => r.ts >= t);
  }
  if (f.to) {
    const t = Date.parse(f.to) / 1000 + 86_400;
    if (Number.isFinite(t)) list = list.filter((r) => r.ts <= t);
  }
  return list.sort((a, b) => b.ts - a.ts);
}

export function historyCsv(rows: readonly HistoryRow[]): string {
  const headers = [
    "time_utc",
    "time_local",
    "type",
    "market",
    "intent_or_outcome",
    "side",
    "price",
    "size",
    "yes_delta",
    "no_delta",
    "usdc_delta",
    "sig",
  ];
  const lines = rows.map((r) =>
    [
      new Date(r.ts * 1000).toISOString(),
      new Date(r.ts * 1000).toLocaleString("en-US", { timeZone: "America/Chicago" }),
      r.type,
      r.marketLabel,
      r.intent,
      r.side ?? "",
      r.price ?? "",
      r.size ?? "",
      r.yesDelta,
      r.noDelta,
      r.usdcDelta,
      r.sig ?? "",
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

const DEMO_TYPE: Record<DemoFill["type"], HistoryType> = {
  fill: "trade",
  settlement: "settlement",
  redemption: "redemption",
  cancel: "cancel",
};

/** Localnet fixture mode only. */
export function demoHistoryRows(nowSec: number): HistoryRow[] {
  return buildDemoHistory(nowSec).map((d) => {
    const size = d.size;
    const signed = (n: number) => (d.type === "fill" && d.intentOrOutcome.startsWith("Sell") ? -n : n);
    return {
      id: d.id,
      sig: d.sig,
      ts: d.ts,
      type: DEMO_TYPE[d.type],
      marketId: d.marketId,
      marketLabel: d.marketLabel,
      intent: d.intentOrOutcome,
      side: d.side,
      size,
      price: d.price ?? undefined,
      yesDelta: d.type === "fill" && d.side === "yes" ? signed(size) : 0,
      noDelta: d.type === "fill" && d.side === "no" ? signed(size) : 0,
      usdcDelta: d.amountUsdc ?? 0,
    };
  });
}
