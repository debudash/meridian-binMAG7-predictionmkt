import Link from "next/link";
import { oneLineExplainer } from "@/lib/copy/payoff";
import { DEFAULT_PROGRAM_ID } from "@/lib/solana/config";

export default function RulesPage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Rules</h1>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ margin: 0 }}>{oneLineExplainer()}</p>
        <p className="muted" style={{ margin: 0 }}>
          One Phoenix order book per market. Yes is the base asset; No price = 1.00 − Yes price for
          display. Meridian&apos;s trading screen keeps one side per market so exposure and payoff
          stay unambiguous.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Resolution uses a Pyth equity price feed at the market&apos;s stated observation time.
          Exact confidence / staleness gates: see <code>docs/SCHEMA.md</code>.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          You can lose the full amount you pay for a contract. Fees (Phoenix + any protocol fee)
          are shown separately from payoff.
        </p>
        <p className="muted" style={{ margin: 0, fontFamily: "var(--mono)", fontSize: "0.8rem" }}>
          Default program id: {DEFAULT_PROGRAM_ID}
        </p>
        <Link href="/markets">Browse markets</Link>
      </div>
    </div>
  );
}
