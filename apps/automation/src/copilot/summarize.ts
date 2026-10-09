/**
 * Operator copilot, step 2 of 3: the words.
 *
 * Claude turns the facts into a short message for the on-call operator. Two guards keep it honest:
 *   - it only sees the facts object (public addresses, prices and counts; never keys or logs with secrets);
 *   - every number in its reply must appear in the facts (`verifyNumbers`), otherwise the plain template is sent.
 * Without an API key, or if the call fails, the template is sent. The AI is never in the critical path.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CopilotFacts, MarketFact } from "./facts";

export const DEFAULT_COPILOT_MODEL = "claude-opus-5-5";

const SYSTEM = `You write the status message that the on-call operator of Meridian reads in Slack. Meridian runs daily Yes/No markets on whether each MAG7 stock closes at or above a strike, on Solana devnet; markets are created by 08:00 ET and settle from the Pyth price at the 16:00 ET close.

The user message is a JSON facts object computed by code. Write at most 6 short plain-text lines:
- Line 1 starts with ✅ when "ok" is true, ⚠️ when it is false, and says what the checkpoint found.
- If there are issues, list each one, say that a person needs to act, and point to the runbook: docs/DEPLOY.md section 6.
- For a settle checkpoint, give each market as SYMBOL ≥ $strike: YES or NO at $closePrice.
Use only numbers that appear in the facts. Do not compute differences, percentages or totals. Do not give trading advice or predict prices.`;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function marketLine(m: MarketFact): string {
  if (m.closePrice !== null) return `${m.symbol} ≥ ${money(m.strike)}: ${m.state === "settled-yes" ? "YES" : "NO"} at ${money(m.closePrice)}`;
  return `${m.symbol} ≥ ${money(m.strike)}: ${m.state}`;
}

/** The deterministic message: always correct, sent whenever the AI is off, fails, or adds a number of its own. */
export function templateSummary(f: CopilotFacts): string {
  const c = f.counts;
  const head =
    f.checkpoint === "create"
      ? `${f.ok ? "✅" : "⚠️"} Create check ${f.dateKey}: ${c.created}/${c.expected} markets, ${c.withBook} with an order book.`
      : `${f.ok ? "✅" : "⚠️"} Settle check ${f.dateKey}: ${c.settledYes + c.settledNo}/${c.created} settled (${c.settledYes} YES, ${c.settledNo} NO).`;
  const lines = [head];
  if (f.issues.length) {
    lines.push(...f.issues.map((i) => `• ${i}`));
    lines.push("Action needed: see docs/DEPLOY.md §6.");
  }
  if (f.checkpoint === "settle") lines.push(...f.markets.map(marketLine));
  return lines.join("\n");
}

/** Every number the summary is allowed to contain: the facts' own figures plus fixed schedule and doc numbers. */
function allowedNumbers(f: CopilotFacts): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    out.add(String(Number(n.toFixed(2))));
  };
  Object.values(f.counts).forEach(add);
  for (const m of f.markets) {
    add(m.strike);
    if (m.closePrice !== null) add(m.closePrice);
  }
  f.dateKey.split("-").forEach((p) => add(Number(p)));
  for (const i of f.issues) (i.match(/\d+(?:\.\d+)?/g) ?? []).forEach((n) => add(Number(n)));
  // Schedule and doc numbers the prompt itself uses: 08:00, 16:00 / 4 PM, 16:05, docs/DEPLOY.md §6, MAG7.
  [0, 4, 5, 6, 7, 8, 16].forEach(add);
  return out;
}

/** Numbers in `text` that do not appear in the facts. Empty = the summary invents nothing. */
export function verifyNumbers(text: string, f: CopilotFacts): string[] {
  const allowed = allowedNumbers(f);
  const found = text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];
  return found.filter((n) => !allowed.has(String(Number(Number(n).toFixed(2)))));
}

/** Only `beta.messages.create` is used, so tests can pass a stub. */
export type CopilotClient = Pick<Anthropic, "beta">;

export async function aiSummary(f: CopilotFacts, client: CopilotClient, model: string): Promise<string> {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 2048,
    // A short summary of given facts: low effort is enough. Refusals reroute server-side.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(f) }],
  });
  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("empty reply");
  return text;
}

export interface Summary {
  text: string;
  source: "ai" | "template";
  /** Why the template was used instead of the AI text, when it was. */
  note?: string;
}

export async function summarize(
  f: CopilotFacts,
  opts: { client: CopilotClient | null; model?: string },
): Promise<Summary> {
  const template = templateSummary(f);
  if (!opts.client) return { text: template, source: "template", note: "AI off (no ANTHROPIC_API_KEY or --no-ai)" };
  let text: string;
  try {
    text = await aiSummary(f, opts.client, opts.model ?? DEFAULT_COPILOT_MODEL);
  } catch (e) {
    return { text: template, source: "template", note: `AI call failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` };
  }
  const invented = verifyNumbers(text, f);
  if (invented.length) return { text: template, source: "template", note: `AI summary rejected: numbers not in the facts (${invented.join(", ")})` };
  return { text, source: "ai" };
}
