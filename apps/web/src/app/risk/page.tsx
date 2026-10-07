import Link from "next/link";

export default function RiskPage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Risk disclosure</h1>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ margin: 0 }}>
          Binary outcome markets can expire worthless. Prices are implied probabilities, not
          guarantees. Smart-contract, oracle, and custody risks apply. Network fees (SOL) are
          required to transact.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Placeholder risk page per docs/ui/07 (OPEN). Not investment advice.{" "}
          <Link href="/terms">Terms</Link> · <Link href="/rules">Rules</Link>.
        </p>
        <Link href="/markets">Browse markets</Link>
      </div>
    </div>
  );
}
