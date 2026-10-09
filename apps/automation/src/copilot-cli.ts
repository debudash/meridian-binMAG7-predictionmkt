/**
 * Operator copilot, manual run (read-only). The worker runs the same checks itself at 08:30 / 16:30 ET (D-030,
 * src/copilot/runner.ts) and shows them on the web Status page; this CLI is for an ad-hoc check of any day.
 * Code decides the facts and writes the message; Claude only adds the headline when ANTHROPIC_API_KEY is set.
 *
 *   node dist/copilot-cli.js --checkpoint create|settle [--date YYYY-MM-DD] [--per-symbol N] [--no-ai] [--json]
 *
 * --per-symbol defaults to the worker's STRIKE_OFFSETS_E6 length (staging: 1). Exit 0 = all good, 2 = issues found
 * (or a calendar ALERT).
 *
 * Env: SOLANA_RPC_URL, MERIDIAN_PROGRAM_ID, MERIDIAN_IDL_PATH, STRIKE_SYMBOLS, STRIKE_OFFSETS_E6 (same as the worker;
 *   no keypairs needed). ANTHROPIC_API_KEY optional (without it the code headline is used). COPILOT_MODEL optional
 *   (default claude-opus-5-5). Prints to stdout only; never prints keys.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "./config";
import { etWall, etWallClockToUnix, isAlertCode, isTradingDay } from "./marketDay";
import { createProgram } from "./solana/client";
import { buildFacts, type Checkpoint } from "./copilot/facts";
import { fetchDayMarkets } from "./copilot/runner";
import { DEFAULT_COPILOT_MODEL, summarize } from "./copilot/summarize";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const checkpoint = arg("--checkpoint") as Checkpoint | undefined;
  if (checkpoint !== "create" && checkpoint !== "settle") throw new Error("--checkpoint create|settle required");
  const nowSec = Math.floor(Date.now() / 1000);
  const dateKey = arg("--date") ?? etWall(nowSec).dateKey;

  const day = isTradingDay(dateKey);
  if (!day.ok) {
    // Weekends and holidays are routine; a missing holiday table or an early close is an ALERT (same codes as the worker).
    const alert = isAlertCode(day.code);
    console.log(`[copilot] ${alert ? "ALERT " : ""}no session on ${dateKey}: ${day.reason}`);
    if (alert) process.exitCode = 2;
    return;
  }

  const cfg = loadConfig(process.env);
  const perSymbol = Number(arg("--per-symbol") ?? cfg.strikeOffsetsE6.length);
  if (!Number.isInteger(perSymbol) || perSymbol < 1) throw new Error("--per-symbol must be a positive integer");
  const closeTs = etWallClockToUnix(dateKey, 16);

  const { program } = createProgram(cfg, Keypair.generate()); // read-only: never signs

  const facts = buildFacts({
    checkpoint,
    dateKey,
    closeTs,
    nowSec,
    expectedSymbols: cfg.symbols,
    perSymbol,
    chain: await fetchDayMarkets(program, closeTs),
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(facts, null, 2));

  const useAi = !process.argv.includes("--no-ai") && !!process.env.ANTHROPIC_API_KEY;
  const summary = await summarize(facts, {
    client: useAi ? new Anthropic() : null,
    model: process.env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
  });
  console.log(summary.text);
  console.log(`[copilot] ${checkpoint} ${dateKey}: headline=${summary.source}${summary.note ? ` (${summary.note})` : ""}`);
  if (!facts.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[copilot] ALERT copilot failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    process.exit(1);
  });
}
