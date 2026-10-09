/**
 * D-030 Status page data: the operator copilot's recent checkpoint reports, read server-side from the automation
 * worker's GET /copilot over Railway private networking. AUTOMATION_STATUS_URL is server-only (never NEXT_PUBLIC_)
 * and is never shown on the page or in errors.
 */
export interface CopilotReport {
  at: string;
  checkpoint: "create" | "settle";
  dateKey: string;
  ok: boolean;
  headline: "ai" | "template" | "error";
  note?: string;
  text: string;
}

export type CopilotStatus = { ok: true; reports: CopilotReport[] } | { ok: false; reason: string };

function isReport(r: any): r is CopilotReport {
  return (
    r &&
    typeof r.at === "string" &&
    (r.checkpoint === "create" || r.checkpoint === "settle") &&
    typeof r.dateKey === "string" &&
    typeof r.ok === "boolean" &&
    typeof r.text === "string"
  );
}

export async function loadCopilotStatus(
  url: string | undefined = process.env.AUTOMATION_STATUS_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CopilotStatus> {
  if (!url) return { ok: false, reason: "The status feed is not configured on this deployment." };
  try {
    const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `The automation worker answered HTTP ${res.status}.` };
    const body = await res.json();
    const reports = Array.isArray(body?.reports) ? body.reports.filter(isReport) : [];
    return { ok: true, reports };
  } catch {
    return { ok: false, reason: "The automation worker could not be reached." };
  }
}

/** "Oct 9, 4:30 PM ET" */
export function formatEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}
