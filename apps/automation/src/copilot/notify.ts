/**
 * Operator copilot, step 3 of 3: delivery. Always prints to stdout (so the Railway / cron log has it); also posts to a
 * Slack incoming webhook when COPILOT_SLACK_WEBHOOK_URL is set. The webhook URL is a secret and is never printed.
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
  const f: FetchLike = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
  try {
    const res = await f(opts.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? "slack sent" : `slack failed HTTP ${res.status}`;
  } catch (e) {
    return `slack failed ${String(e instanceof Error ? e.message : e).slice(0, 120)}`;
  }
}
