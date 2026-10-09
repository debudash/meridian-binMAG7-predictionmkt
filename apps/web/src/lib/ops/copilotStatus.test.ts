import { describe, expect, it } from "vitest";
import { formatEt, loadCopilotStatus } from "./copilotStatus";

const URL_ = "http://automation.railway.internal:8080/copilot";
const report = { at: "2026-10-09T20:30:00.000Z", checkpoint: "settle", dateKey: "2026-10-09", ok: true, headline: "template", text: "✅ Settle check 2026-10-09: 7/7 settled (4 YES, 3 NO).\nNVDA ≥ $230.00: NO at $229.34" };
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe("D-030 status feed", () => {
  it("returns the worker's reports and drops malformed ones", async () => {
    const s = await loadCopilotStatus(URL_, (async () => res(200, { reports: [report, { junk: 1 }] })) as typeof fetch);
    expect(s).toEqual({ ok: true, reports: [report] });
  });
  it("explains a missing config, an HTTP error and an unreachable worker without echoing the internal URL", async () => {
    const outs = [
      await loadCopilotStatus(undefined),
      await loadCopilotStatus(URL_, (async () => res(503, {})) as typeof fetch),
      await loadCopilotStatus(URL_, (async () => {
        throw new TypeError(`fetch failed ${URL_}`);
      }) as typeof fetch),
    ];
    for (const o of outs) {
      expect(o.ok).toBe(false);
      expect(JSON.stringify(o)).not.toContain("railway.internal");
    }
  });
  it("formats the check time in ET", () => {
    expect(formatEt("2026-10-09T20:30:00.000Z")).toBe("Oct 9, 4:30 PM ET");
  });
});
