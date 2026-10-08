/**
 * Trade page: after a trade confirms, the Fills row must appear without a reload (DLV-114).
 * Root cause: TradeTicket never invalidated the shared caches after its own tx; the history query
 * (Fills tab) only polls every 60 s while the tab is open (never otherwise) with a 30 s staleTime, so
 * the new fill showed only after a reload. Also getSignaturesForAddress can lag the confirmation by a
 * moment, so a single refetch can still miss the tx: refetch with a short bounded retry until the
 * signature is in the history rows.
 */
import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  HISTORY_RETRY_DELAYS_MS,
  WALLET_ACCOUNT_KEY,
  WALLET_HISTORY_KEY,
  historyHasSig,
  refreshAfterOwnTx,
  shouldRefetchOnFillsOpen,
} from "./refreshAfterOwnTx";

const SIG = "5ig111111111111111111111111111111111111111111111111111111111111111111111111111111111111";
const row = (sig?: string) => ({ id: sig ?? "x", sig, ts: 1, type: "trade", marketId: "m", marketLabel: "M", intent: "Buy Yes", yesDelta: 5, noDelta: 0 });
const noSleep = async () => {};

function setup(historyResponses: Array<{ rows: unknown[] }>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let historyCalls = 0;
  let accountCalls = 0;
  const historyObs = new QueryObserver(qc, {
    queryKey: [WALLET_HISTORY_KEY, "owner", "m:open", "http://rpc"],
    staleTime: 30_000,
    queryFn: async () => historyResponses[Math.min(historyCalls++, historyResponses.length - 1)],
  });
  const accountObs = new QueryObserver(qc, {
    queryKey: [WALLET_ACCOUNT_KEY, "owner", "m", "http://rpc"],
    staleTime: 5_000,
    queryFn: async () => ({ n: accountCalls++ }),
  });
  const unsub = [historyObs.subscribe(() => {}), accountObs.subscribe(() => {})];
  return { qc, calls: () => ({ history: historyCalls, account: accountCalls }), done: () => unsub.forEach((u) => u()) };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("refreshAfterOwnTx (DLV-114)", () => {
  it("historyHasSig finds the tx signature in wallet-history data", () => {
    expect(historyHasSig({ rows: [row("a"), row(SIG)] }, SIG)).toBe(true);
    expect(historyHasSig({ rows: [row("a"), row()] }, SIG)).toBe(false);
    expect(historyHasSig(undefined, SIG)).toBe(false);
  });

  it("refetches the wallet account and the history (fresh cache, no reload) right after the trade confirms", async () => {
    const s = setup([{ rows: [] }, { rows: [row(SIG)] }]);
    await settle();
    expect(s.calls()).toEqual({ history: 1, account: 1 });
    const r = await refreshAfterOwnTx(s.qc, SIG, { sleep: noSleep });
    await settle();
    expect(r.historyFound).toBe(true);
    expect(r.historyAttempts).toBe(1);
    expect(s.calls().account).toBeGreaterThanOrEqual(2);
    expect(historyHasSig(s.qc.getQueriesData({ queryKey: [WALLET_HISTORY_KEY] })[0][1], SIG)).toBe(true);
    s.done();
  });

  it("retries (bounded) while the RPC history doesn't list the signature yet", async () => {
    const s = setup([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [row(SIG)] }]);
    await settle();
    const waits: number[] = [];
    const r = await refreshAfterOwnTx(s.qc, SIG, { sleep: async (ms) => void waits.push(ms) });
    expect(r.historyFound).toBe(true);
    expect(r.historyAttempts).toBe(3);
    expect(waits).toEqual(HISTORY_RETRY_DELAYS_MS.slice(1, 3)); // first refetch is immediate
    s.done();
  });

  it("gives up after the bounded schedule (no endless polling)", async () => {
    const s = setup([{ rows: [] }]);
    await settle();
    const r = await refreshAfterOwnTx(s.qc, SIG, { sleep: noSleep });
    expect(r.historyFound).toBe(false);
    expect(r.historyAttempts).toBe(HISTORY_RETRY_DELAYS_MS.length);
    expect(s.calls().history).toBe(1 + HISTORY_RETRY_DELAYS_MS.length);
    expect(HISTORY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
    s.done();
  });

  it("no mounted history query → no retry loop (just invalidated for the next mount)", async () => {
    const qc = new QueryClient();
    const r = await refreshAfterOwnTx(qc, SIG, { sleep: noSleep });
    expect(r.historyAttempts).toBe(0);
  });

  it("opening the Fills tab refetches history older than 10 s", () => {
    expect(shouldRefetchOnFillsOpen(0, 100_000)).toBe(true);
    expect(shouldRefetchOnFillsOpen(95_000, 100_000)).toBe(false);
    expect(shouldRefetchOnFillsOpen(80_000, 100_000)).toBe(true);
  });
});

describe("wiring", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const read = (f: string) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
  it("TradeTicket refreshes the shared caches after a confirmed (or unconfirmed) trade", () => {
    const src = read("components/trade/TradeTicket.tsx");
    expect(src).toMatch(/refreshAfterOwnTx\(queryClient, result\.signature/);
  });
  it("TradeClient refetches stale history when the Fills tab opens", () => {
    expect(read("app/markets/[marketId]/TradeClient.tsx")).toMatch(/shouldRefetchOnFillsOpen\(/);
  });
  it("hooks share the query keys with the helper", () => {
    expect(read("hooks/useWalletHistory.ts")).toMatch(/WALLET_HISTORY_KEY/);
    expect(read("hooks/useWalletAccount.ts")).toMatch(/refreshAfterOwnTx/);
  });
});
