/**
 * Operator copilot, step 2 of 3: the words.
 *
 * Code writes the message: the ✅/⚠️ mark, every issue, the runbook pointer and every market line come from the facts.
 * Claude only writes the headline sentence at the top (what the checkpoint found and what to do first). Guards:
 *   - Claude sees a trimmed facts object (symbols, strikes, states, prices, counts, issues; no addresses or secrets);
 *   - `verifyHeadline` rejects a headline with a number outside the counts / issues / schedule, a percentage, a
 *     spelled-out number, YES/NO counts that don't match, an all-clear tone while there are issues, or extra length;
 *   - a rejected headline, no API key, an API error, a refusal or a truncated reply all fall back to the code headline.
 * The AI is never in the critical path and can't change a fact.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CopilotFacts, MarketFact } from "./facts";

export const DEFAULT_COPILOT_MODEL = "claude-opus-5-5";
export const MAX_HEADLINE_CHARS = 300;

const SYSTEM = `You write the headline of the status message that the on-call operator of Meridian reads in Slack. Meridian runs daily Yes/No markets on whether each MAG7 stock closes at or above a strike, on Solana devnet; markets are created by 08:00 ET and settle from the Pyth price at the 16:00 ET close.

The user message is a JSON facts object computed by code. Write one or two short plain sentences (at most ${MAX_HEADLINE_CHARS} characters) saying what this checkpoint found and, when "ok" is false, what the operator should look at first. The runbook is docs/DEPLOY.md section 6.

Code prints the status mark, every issue and every market line under your text, so do not list markets or prices and do not start with an emoji. Write numbers as digits, and only numbers that appear in "counts" or "issues". No percentages, no computed numbers, no trading advice.`;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function marketLine(m: MarketFact): string {
  if (m.closePrice !== null) return `${m.symbol} ≥ ${money(m.strike)}: ${m.state === "settled-yes" ? "YES" : "NO"} at ${money(m.closePrice)}`;
  return `${m.symbol} ≥ ${money(m.strike)}: ${m.state}`;
}

/** The code-written headline: used whenever the AI is off, fails, or its headline is rejected. */
export function templateHeadline(f: CopilotFacts): string {
  const c = f.counts;
  return f.checkpoint === "create"
    ? `Create check ${f.dateKey}: ${c.created}/${c.expected} markets, ${c.withBook} with an order book.`
    : `Settle check ${f.dateKey}: ${c.settledYes + c.settledNo}/${c.created} settled (${c.settledYes} YES, ${c.settledNo} NO).`;
}

/** The full message. Everything except `headline` comes straight from the facts. */
export function composeMessage(f: CopilotFacts, headline: string = templateHeadline(f)): string {
  const lines = [`${f.ok ? "✅" : "⚠️"} ${headline}`];
  if (f.issues.length) {
    lines.push(...f.issues.map((i) => `• ${i}`));
    lines.push("Action needed: see docs/DEPLOY.md §6.");
  }
  if (f.checkpoint === "settle") lines.push(...f.markets.map(marketLine));
  return lines.join("\n");
}

/** What Claude sees: no market addresses (base58 has digits) and no timestamps. */
export function promptFacts(f: CopilotFacts) {
  return {
    checkpoint: f.checkpoint,
    dateKey: f.dateKey,
    ok: f.ok,
    counts: f.counts,
    issues: f.issues,
    markets: f.markets.map(({ symbol, strike, state, closePrice }) => ({ symbol, strike, state, closePrice })),
  };
}

const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|dozen|half|all\s+but)\b/i;
const ALL_CLEAR = /\b(all\s+good|all\s+clear|no\s+issues?|nothing\s+to\s+do|healthy|on\s+track)\b/i;

/** Reasons the headline can't be trusted. Empty = use it. */
export function verifyHeadline(text: string, f: CopilotFacts): string[] {
  const problems: string[] = [];
  if (text.length > MAX_HEADLINE_CHARS) problems.push(`longer than ${MAX_HEADLINE_CHARS} characters`);
  if (text.includes("%")) problems.push("percentage");
  const word = NUMBER_WORDS.exec(text);
  if (word) problems.push(`spelled-out number "${word[0]}"`);

  const allowed = new Set<number>([...Object.values(f.counts), ...f.dateKey.split("-").map(Number), 0, 5, 6, 7, 8, 16]);
  for (const i of f.issues) for (const n of i.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(Number(n));
  const nums = text.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];
  const unknown = nums.filter((n) => !allowed.has(Number(n)));
  if (unknown.length) problems.push(`numbers not in the facts (${unknown.join(", ")})`);

  for (const [, n, side] of text.matchAll(/(\d+)\s*(YES|NO)\b/gi)) {
    const want = side.toUpperCase() === "YES" ? f.counts.settledYes : f.counts.settledNo;
    if (Number(n) !== want) problems.push(`"${n} ${side}" but the facts say ${want}`);
  }
  if (!f.ok && ALL_CLEAR.test(text)) problems.push("all-clear wording while there are issues");
  return problems;
}

/** Only `beta.messages.create` is used, so tests can pass a stub. */
export type CopilotClient = Pick<Anthropic, "beta">;

export async function aiHeadline(f: CopilotFacts, client: CopilotClient, model: string): Promise<string> {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 2048,
    // One or two sentences from given facts: low effort is enough. Refusals reroute server-side.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(promptFacts(f)) }],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`stop_reason ${response.stop_reason}`);
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/^[\s✅⚠️]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("empty reply");
  return text;
}

export interface Summary {
  text: string;
  source: "ai" | "template";
  /** Why the code headline was used instead of the AI one, when it was. */
  note?: string;
}

export async function summarize(
  f: CopilotFacts,
  opts: { client: CopilotClient | null; model?: string },
): Promise<Summary> {
  const fallback = (note: string): Summary => ({ text: composeMessage(f), source: "template", note });
  if (!opts.client) return fallback("AI off (no ANTHROPIC_API_KEY or --no-ai)");
  let headline: string;
  try {
    headline = await aiHeadline(f, opts.client, opts.model ?? DEFAULT_COPILOT_MODEL);
  } catch (e) {
    return fallback(`AI call failed: ${e instanceof Anthropic.APIError ? `HTTP ${e.status}` : String(e instanceof Error ? e.message : e).slice(0, 120)}`);
  }
  const problems = verifyHeadline(headline, f);
  if (problems.length) return fallback(`AI headline rejected: ${problems.join("; ")}`);
  return { text: composeMessage(f, headline), source: "ai" };
}
