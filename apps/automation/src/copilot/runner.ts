/**
 * Operator copilot inside the worker (D-030): no cron. The worker's own tick runs each checkpoint once per session day,
 * 30 min after its event — create at 08:30 ET (deadline 08:00), settle at 16:30 ET (close 16:00) — logs the message
 * and keeps the recent reports in memory for GET /copilot (shown on the web Status page).
 *
 * After a restart (memory is empty) the latest session day's due checkpoints run on the next tick, so the page is never
 * blank: on a weekend that is Friday's create + settle.
 */
import type { Program } from "@coral-xyz/anchor";
import { utils } from "@coral-xyz/anchor";
import { etWall, etWallClockToUnix, isTradingDay, prevTradingDay } from "../marketDay";
import { buildFacts, fromAnchorAccount, type ChainMarket, type Checkpoint } from "./facts";
import { summarize, type CopilotClient } from "./summarize";

export const CHECKPOINT_TIMES: Array<{ checkpoint: Checkpoint; hour: number; minute: number }> = [
  { checkpoint: "create", hour: 8, minute: 30 },
  { checkpoint: "settle", hour: 16, minute: 30 },
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
  /** The logged message (lines joined with \n). */
  text: string;
}

export interface CopilotState {
  done: Set<string>;
  reports: CopilotReport[];
}

export function createCopilotState(): CopilotState {
  return { done: new Set(), reports: [] };
}

/** Today if it is a full session, else the latest full session before it (weekends, holidays, early closes). */
export function latestSessionDay(nowSec: number): string | null {
  let k = etWall(nowSec).dateKey;
  try {
    for (let i = 0; i < 14; i++) {
      if (isTradingDay(k).ok) return k;
      k = prevTradingDay(k);
    }
  } catch {
    // unknown year in the holiday table: the worker already ALERTs on this
  }
  return null;
}

/** Checkpoints whose time has passed on the latest session day and that have not run yet. */
export function dueCheckpoints(nowSec: number, state: CopilotState): Array<{ checkpoint: Checkpoint; dateKey: string }> {
  const dateKey = latestSessionDay(nowSec);
  if (!dateKey) return [];
  return CHECKPOINT_TIMES.filter(
    (t) => nowSec >= etWallClockToUnix(dateKey, t.hour, t.minute) && !state.done.has(`${dateKey}:${t.checkpoint}`),
  ).map((t) => ({ checkpoint: t.checkpoint, dateKey }));
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

export async function runCopilotPass(opts: {
  state: CopilotState;
  nowSec: number;
  expectedSymbols: string[];
  perSymbol: number;
  fetchMarkets: (closeTs: number) => Promise<ChainMarket[]>;
  client: CopilotClient | null;
  model?: string;
  log?: (line: string) => void;
}): Promise<CopilotReport[]> {
  const log = opts.log ?? console.log;
  const out: CopilotReport[] = [];
  for (const { checkpoint, dateKey } of dueCheckpoints(opts.nowSec, opts.state)) {
    // Marked done first: a failing check is reported once, not retried every tick.
    opts.state.done.add(`${dateKey}:${checkpoint}`);
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
      report = { at: new Date(opts.nowSec * 1000).toISOString(), checkpoint, dateKey, ok: facts.ok, headline: s.source, note: s.note, text: s.text };
    } catch (e) {
      const why = String(e instanceof Error ? e.message : e).slice(0, 200);
      report = { at: new Date(opts.nowSec * 1000).toISOString(), checkpoint, dateKey, ok: false, headline: "error", text: `⚠️ ${checkpoint} check ${dateKey} could not run: ${why}` };
    }
    for (const line of report.text.split("\n")) log(`[copilot] ${report.ok ? "" : "ALERT "}${line}`);
    opts.state.reports.unshift(report);
    opts.state.reports.length = Math.min(opts.state.reports.length, MAX_REPORTS);
    out.push(report);
  }
  return out;
}
