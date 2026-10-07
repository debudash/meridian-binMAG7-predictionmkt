import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Terms of use</h1>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <p style={{ margin: 0 }}>
          This is a placeholder Terms page (docs/ui/07 OPEN: in-app vs hosted docs). Meridian is
          experimental software. By using the interface you acknowledge markets settle on-chain
          using oracle prices and that you can lose the full amount paid for a contract.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Official legal terms will replace this stub. See also <Link href="/risk">Risk
          disclosure</Link> and <Link href="/rules">Rules</Link>.
        </p>
        <Link href="/markets">Browse markets</Link>
      </div>
    </div>
  );
}
