/**
 * Operator copilot (read-only). Reads the day's markets from the chain, checks them at a checkpoint, and sends the
 * on-call operator a short summary. Code decides the facts; Claude only words them (src/copilot/).
 *
 *   node dist/copilot-cli.js --checkpoint create|settle [--date YYYY-MM-DD] [--no-ai] [--json]
 *
 * Run it after 08:00 ET (create) and after 16:05 ET (settle), e.g. from a scheduler.
 * Exit 0 = all good, 2 = issues found, so a scheduler can alert on the exit code even if Slack or the AI is down.
 *
 * Env: SOLANA_RPC_URL, MERIDIAN_PROGRAM_ID, MERIDIAN_IDL_PATH, STRIKE_SYMBOLS (same as the worker; no keypairs needed).
 *   ANTHROPIC_API_KEY  optional; without it the template summary is sent.
 *   COPILOT_MODEL      optional; default claude-opus-5-5.
 *   COPILOT_SLACK_WEBHOOK_URL  optional Slack incoming webhook; without it the message goes to stdout only.
 * Never prints keys or the webhook URL.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { loadConfig } from "./config";
import { etWall, etWallClockToUnix, isTradingDay } from "./marketDay";
import { createProgram } from "./solana/client";
import { decodeEquitySymbol } from "./strikes";
import { buildFacts, type ChainMarket, type Checkpoint } from "./copilot/facts";
import { DEFAULT_COPILOT_MODEL, summarize } from "./copilot/summarize";
import { notify } from "./copilot/notify";

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
    console.log(`[copilot] no session on ${dateKey} (${day.reason}); nothing to check`);
    return;
  }

  const cfg = loadConfig(process.env);
  const { program } = createProgram(cfg, Keypair.generate()); // read-only: never signs
  const all = await (program.account as any).strikeMarket.all();
  const chain: ChainMarket[] = all.map((m: any) => ({
    market: m.publicKey.toBase58(),
    symbol: decodeEquitySymbol(m.account.equitySymbol),
    strikeE6: BigInt(m.account.strikePriceE6.toString()),
    expiryTs: Number(m.account.expiryTs.toString()),
    status: Number(m.account.status),
    hasBook: !new PublicKey(m.account.phoenixMarket).equals(PublicKey.default),
    settlementPriceE6: BigInt(m.account.settlementPriceE6.toString()),
  }));

  const facts = buildFacts({
    checkpoint,
    dateKey,
    closeTs: etWallClockToUnix(dateKey, 16),
    nowSec,
    expectedSymbols: cfg.symbols,
    chain,
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(facts, null, 2));

  const useAi = !process.argv.includes("--no-ai") && !!process.env.ANTHROPIC_API_KEY;
  const summary = await summarize(facts, {
    client: useAi ? new Anthropic() : null,
    model: process.env.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
  });
  const sent = await notify(summary.text, { slackWebhookUrl: process.env.COPILOT_SLACK_WEBHOOK_URL || undefined });
  console.log(`[copilot] ${checkpoint} ${dateKey}: summary=${summary.source}${summary.note ? ` (${summary.note})` : ""}; ${sent}`);
  if (!facts.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[copilot] ALERT copilot failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    process.exit(1);
  });
}
