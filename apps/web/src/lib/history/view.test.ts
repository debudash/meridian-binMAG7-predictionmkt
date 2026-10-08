/** History filtering / CSV / demo mapping (DLV-088). */
import { describe, expect, it } from "vitest";
import { demoHistoryRows, filterHistory, historyCsv, type HistoryFilters } from "./view";
import type { HistoryRow } from "./classify";

const base: HistoryRow = {
  id: "a", sig: "sigA", ts: 1_791_400_000, type: "trade", marketId: "m1", marketLabel: "AAPL ≥ $230",
  intent: "Buy Yes", side: "yes", size: 10, price: 0.6, yesDelta: 10, noDelta: 0, usdcDelta: -6,
};
const rows: HistoryRow[] = [
  base,
  { ...base, id: "b", sig: "sigB", ts: base.ts + 10, type: "cancel", intent: "Cancel", side: undefined, size: undefined, price: undefined, yesDelta: 0, usdcDelta: 0 },
  { ...base, id: "c", sig: undefined, ts: base.ts + 20, type: "settlement", marketId: "m2", marketLabel: "MSFT ≥ $420", intent: "Result: No", side: "no", usdcDelta: 0, yesDelta: 0 },
];
const all: HistoryFilters = { type: "all", side: "all", market: "", from: "", to: "" };

describe("filterHistory", () => {
  it("sorts newest first and filters by type groups", () => {
    expect(filterHistory(rows, all).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(filterHistory(rows, { ...all, type: "fills" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterHistory(rows, { ...all, type: "cancels" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterHistory(rows, { ...all, type: "settlements" }).map((r) => r.id)).toEqual(["c"]);
  });
  it("filters by side and market text", () => {
    expect(filterHistory(rows, { ...all, side: "no" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterHistory(rows, { ...all, market: "msft" }).map((r) => r.id)).toEqual(["c"]);
  });
});

describe("historyCsv", () => {
  it("has ISO UTC + Chicago columns and on-chain deltas", () => {
    const csv = historyCsv([base]);
    const [head, line] = csv.split("\n");
    expect(head).toBe("time_utc,time_local,type,market,intent_or_outcome,side,price,size,yes_delta,no_delta,usdc_delta,sig");
    expect(line).toContain('"2026-10-07T');
    expect(line).toContain('"-6"');
    expect(line).toContain('"sigA"');
  });
});

describe("demoHistoryRows", () => {
  it("maps fixture history onto HistoryRow (fixture markets only)", () => {
    const d = demoHistoryRows(1_791_400_000);
    expect(d.length).toBeGreaterThan(0);
    for (const r of d) expect(r.marketId.startsWith("fixture-")).toBe(true);
    expect(d.some((r) => r.type === "trade")).toBe(true);
  });
});
