/**
 * Operator copilot (read-only). Reads the day's markets from the chain, checks them at a checkpoint, and sends the
 * on-call operator a short summary. Code decides the facts and writes the message; Claude only adds the headline
 * (src/copilot/).
 *
 *   node dist/copilot-cli.js --checkpoint create|settle [--date YYYY-MM-DD] [--per-symbol N] [--no-ai] [--json]
 *
 * Run it after 08:00 ET (create) and after 16:05 ET (settle), e.g. from a scheduler. --per-symbol defaults to the
 * worker's STRIKE_OFFSETS_E6 length (3); use 1 for days created by the ops bootstrap with single operator strikes.
 * Exit 0 = all good, 2 = issues found (or a calendar ALERT), so a scheduler can alert even if Slack or the AI is down.
 *
 * Env: SOLANA_RPC_URL, MERIDIAN_PROGRAM_ID, MERIDIAN_IDL_PATH, STRIKE_SYMBOLS, STRIKE_OFFSETS_E6 (same as the worker;
 *   no keypairs needed). ANTHROPIC_API_KEY optional (without it the code headline is used). COPILOT_MODEL optional
 *   (default claude-opus-5-5). COPILOT_SLACK_WEBHOOK_URL optional (without it the message goes to stdout only).
 * Never prints keys or the webhook URL.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Keypair } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { loadConfig } from "./config";
import { etWall, etWallClockToUnix, isAlertCode, isTradingDay } from "./marketDay";
import { createProgram } from "./solana/client";
import { buildFacts, fromAnchorAccount, type Checkpoint } from "./copilot/facts";
import { DEFAULT_COPILOT_MODEL, summarize } from "./copilot/summarize";
import { notify } from "./copilot/notify";

/** Byte offset of StrikeMarket.expiry_ts: discriminator 8 + config 32 + market_id 8 + equity_symbol 8 +
 *  pyth_price_feed 32 + pyth_feed_id 32 + strike_price_e6 8 (idl/meridian.prod.json). */
const EXPIRY_TS_OFFSET = 128;

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
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(BigInt(closeTs));
  const accounts = await (program.account as any).strikeMarket.all([
    { memcmp: { offset: EXPIRY_TS_OFFSET, bytes: utils.bytes.bs58.encode(expiry) } },
  ]);

  const facts = buildFacts({
    checkpoint,
    dateKey,
    closeTs,
    nowSec,
    expectedSymbols: cfg.symbols,
    perSymbol,
    chain: accounts.map(fromAnchorAccount),
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(facts, null, 2));

  const useAi = !process.argv.includes("--no-ai") && !!process.env.ANTHROPIC_API_KEY;
  const summary = await summarize(facts, {
    client: useAi ? new Anthropic() : null,
    model: process.env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
  });
  const sent = await notify(summary.text, { slackWebhookUrl: process.env.COPILOT_SLACK_WEBHOOK_URL || undefined });
  console.log(`[copilot] ${checkpoint} ${dateKey}: headline=${summary.source}${summary.note ? ` (${summary.note})` : ""}; ${sent}`);
  if (!facts.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[copilot] ALERT copilot failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    process.exit(1);
  });
}
