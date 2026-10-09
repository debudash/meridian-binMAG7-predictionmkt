/**
 * Operator copilot, step 3 of 3: delivery. Always prints to stdout (so the Railway / cron log has it); also posts to a
 * Slack incoming webhook when COPILOT_SLACK_WEBHOOK_URL is set. The webhook URL is a secret: it is never printed,
 * not even inside an error message (Node's fetch echoes a malformed URL back in its error).
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export async function notify(
  text: string,
  opts: { slackWebhookUrl?: string; fetchImpl?: FetchLike; log?: (line: string) => void },
): Promise<string> {
  (opts.log ?? console.log)(text);
  if (!opts.slackWebhookUrl) return "slack skipped (no COPILOT_SLACK_WEBHOOK_URL)";
  try {
    if (new URL(opts.slackWebhookUrl).protocol !== "https:") return "slack failed (webhook URL is not https)";
  } catch {
    return "slack failed (invalid webhook URL)";
  }
  const f: FetchLike = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
  try {
    const res = await f(opts.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? "slack sent" : `slack failed HTTP ${res.status}`;
  } catch (e) {
    // Name / network code only: the message can contain the URL.
    const code = (e as any)?.cause?.code ?? (e as any)?.code;
    return `slack failed (${e instanceof Error ? e.name : "error"}${code ? ` ${code}` : ""})`;
  }
}
