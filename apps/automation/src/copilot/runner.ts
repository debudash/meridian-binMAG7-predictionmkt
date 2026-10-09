/**
 * Operator copilot inside the worker (D-030): no cron. The worker's own tick starts each checkpoint once per session
 * day, 30 min after its event — create at 08:30 ET (deadline 08:00), settle at 16:30 ET (close 16:00), plus one
 * settle re-check at 17:30 ET only when the 16:30 result needed attention. Each report is logged and kept in memory
 * for GET /copilot (shown on the web Status page).
 *
 * The session day shown is the latest one whose 08:30 check time has passed: before 08:30 on a trading day that is
 * the previous session, so after a restart the page shows the last full day instead of nothing.
 * The worker starts the pass without awaiting it (`startCopilotPass`), so it can never hold up create / pause / settle.
 */
import type { Program } from "@coral-xyz/anchor";
import { utils } from "@coral-xyz/anchor";
import { etWall, etWallClockToUnix, isTradingDay, prevTradingDay } from "../marketDay";
import { buildFacts, fromAnchorAccount, type ChainMarket, type Checkpoint } from "./facts";
import { summarize, type CopilotClient } from "./summarize";

type Slot = "create" | "settle" | "settle-recheck";
export const CHECKPOINT_TIMES: Array<{ slot: Slot; checkpoint: Checkpoint; hour: number; minute: number }> = [
  { slot: "create", checkpoint: "create", hour: 8, minute: 30 },
  { slot: "settle", checkpoint: "settle", hour: 16, minute: 30 },
  { slot: "settle-recheck", checkpoint: "settle", hour: 17, minute: 30 },
];
export const MAX_REPORTS = 20;

/** Byte offset of StrikeMarket.expiry_ts: discriminator 8 + config 32 + market_id 8 + equity_symbol 8 +
 *  pyth_price_feed 32 + pyth_feed_id 32 + strike_price_e6 8 (idl/meridian.prod.json). */
const EXPIRY_TS_OFFSET = 128;

export interface CopilotReport {
  /** ISO time the check ran. */
  at: string;
  checkpoint: Checkpoint;
  dateKey: string;
  ok: boolean;
  headline: "ai" | "template" | "error";
  note?: string;
  /** The logged message (lines joined with \n). Public: shown on the Status page. */
  text: string;
}

export interface CopilotState {
  done: Set<string>;
  reports: CopilotReport[];
  /** A pass is in flight: later ticks skip instead of starting a second one. */
  running: boolean;
}

export function createCopilotState(): CopilotState {
  return { done: new Set(), reports: [], running: false };
}

/** Latest full session whose 08:30 ET create check time has passed (weekends, holidays, early closes skipped). */
export function latestSessionDay(nowSec: number): string | null {
  let k = etWall(nowSec).dateKey;
  try {
    for (let i = 0; i < 14; i++) {
      if (isTradingDay(k).ok && nowSec >= etWallClockToUnix(k, 8, 30)) return k;
      k = prevTradingDay(k);
    }
  } catch {
    // unknown year in the holiday table: the worker already ALERTs on this
  }
  return null;
}

/** Slots whose time has passed on the latest session day and that have not run yet. */
export function dueCheckpoints(nowSec: number, state: CopilotState): Array<{ slot: Slot; checkpoint: Checkpoint; dateKey: string }> {
  const dateKey = latestSessionDay(nowSec);
  if (!dateKey) return [];
  return CHECKPOINT_TIMES.filter(
    (t) => nowSec >= etWallClockToUnix(dateKey, t.hour, t.minute) && !state.done.has(`${dateKey}:${t.slot}`),
  ).map((t) => ({ slot: t.slot, checkpoint: t.checkpoint, dateKey }));
}

/** The day's StrikeMarkets only (memcmp on expiry_ts), decoded for buildFacts. */
export async function fetchDayMarkets(program: Program, closeTs: number): Promise<ChainMarket[]> {
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(BigInt(closeTs));
  const accounts = await (program.account as any).strikeMarket.all([
    { memcmp: { offset: EXPIRY_TS_OFFSET, bytes: utils.bytes.bs58.encode(expiry) } },
  ]);
  return accounts.map(fromAnchorAccount);
}

export interface CopilotPassOpts {
  state: CopilotState;
  nowSec: number;
  expectedSymbols: string[];
  perSymbol: number;
  fetchMarkets: (closeTs: number) => Promise<ChainMarket[]>;
  client: CopilotClient | null;
  model?: string;
  log?: (line: string) => void;
}

export async function runCopilotPass(opts: CopilotPassOpts): Promise<CopilotReport[]> {
  const log = opts.log ?? console.log;
  const due = dueCheckpoints(opts.nowSec, opts.state);
  // Mark every due slot first: a failing or slow check is reported once, never twice.
  for (const d of due) opts.state.done.add(`${d.dateKey}:${d.slot}`);
  const out: CopilotReport[] = [];
  for (const { slot, checkpoint, dateKey } of due) {
    if (slot === "settle-recheck") {
      const last = opts.state.reports.find((r) => r.dateKey === dateKey && r.checkpoint === "settle");
      if (!last || last.ok) continue; // only re-check a settle result that needed attention
    }
    const at = new Date(opts.nowSec * 1000).toISOString();
    let report: CopilotReport;
    try {
      const closeTs = etWallClockToUnix(dateKey, 16);
      const facts = buildFacts({
        checkpoint,
        dateKey,
        closeTs,
        nowSec: opts.nowSec,
        expectedSymbols: opts.expectedSymbols,
        perSymbol: opts.perSymbol,
        chain: await opts.fetchMarkets(closeTs),
      });
      const s = await summarize(facts, { client: opts.client, model: opts.model });
      report = { at, checkpoint, dateKey, ok: facts.ok, headline: s.source, note: s.note, text: s.text };
    } catch (e) {
      // Full error to the log only: an RPC error can carry a keyed URL. The public report says what failed, not why.
      log(`[copilot] ALERT ${checkpoint} check ${dateKey} error: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
      report = { at, checkpoint, dateKey, ok: false, headline: "error", text: `⚠️ ${checkpoint} check ${dateKey} could not read the chain; see the worker log.` };
    }
    for (const line of report.text.split("\n")) log(`[copilot] ${report.ok ? "" : "ALERT "}${line}`);
    opts.state.reports.unshift(report);
    opts.state.reports.length = Math.min(opts.state.reports.length, MAX_REPORTS);
    out.push(report);
  }
  return out;
}

/**
 * Worker entry: starts a pass in the background and returns at once. Skips while one is in flight, so a slow RPC or
 * AI call can't delay the tick or stack up passes.
 */
export function startCopilotPass(opts: CopilotPassOpts): Promise<void> | null {
  if (opts.state.running || dueCheckpoints(opts.nowSec, opts.state).length === 0) return null;
  opts.state.running = true;
  return runCopilotPass(opts)
    .then(() => undefined)
    .catch((e) => (opts.log ?? console.error)(`[copilot] ALERT copilot pass error: ${String(e).slice(0, 300)}`))
    .finally(() => {
      opts.state.running = false;
    });
}
