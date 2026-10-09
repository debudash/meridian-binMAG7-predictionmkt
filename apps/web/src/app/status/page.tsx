import type { Metadata } from "next";
import Link from "next/link";
import { formatEt, loadCopilotStatus } from "@/lib/ops/copilotStatus";

// Always fresh: the worker adds a report at 08:30 and 16:30 ET (D-030).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Status · Meridian" };

export default async function StatusPage() {
  const status = await loadCopilotStatus();
  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <h1 style={{ marginTop: 0 }}>Status</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        The automation worker checks each trading day twice: at 08:30 ET that every market was created with an order
        book, and at 16:30 ET that every market settled. The facts come from the chain; the same report is in the
        worker log. See <Link href="/rules">Rules</Link> for how markets resolve.
      </p>

      {!status.ok && (
        <div className="card" role="status">
          <strong>Status unavailable.</strong> <span className="muted">{status.reason}</span>
        </div>
      )}

      {status.ok && status.reports.length === 0 && (
        <div className="card" role="status">
          <strong>No checks yet.</strong>{" "}
          <span className="muted">Checks run at 08:30 ET and 16:30 ET on each trading day.</span>
        </div>
      )}

      {status.ok && status.reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {status.reports.map((r) => {
            const [first, ...rest] = r.text.split("\n");
            return (
              <article key={`${r.dateKey}-${r.checkpoint}-${r.at}`} className="card" data-testid="copilot-report">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={`chip ${r.ok ? "chip-yes" : "chip-no"}`}>{r.ok ? "OK" : "Needs attention"}</span>
                    <strong>{r.checkpoint === "create" ? "Market creation" : "Settlement"} · {r.dateKey}</strong>
                  </span>
                  <span className="muted tabular" style={{ fontSize: "0.8rem" }}>
                    {formatEt(r.at)}
                  </span>
                </div>
                <p style={{ margin: "0.6rem 0 0.4rem" }}>{first}</p>
                {rest.length > 0 && (
                  <pre
                    className="tabular"
                    style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.82rem", color: "var(--text-muted)" }}
                  >
                    {rest.join("\n")}
                  </pre>
                )}
                <div className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem" }}>
                  {r.headline === "ai" ? "Headline written by AI from the facts above" : r.headline === "error" ? "Check could not run" : "Written by code"}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
