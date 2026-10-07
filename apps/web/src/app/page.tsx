import Link from "next/link";
import { listMarkets } from "@/lib/indexer";
import { oneLineExplainer } from "@/lib/copy/payoff";
import { LandingClient } from "./LandingClient";

export default async function LandingPage() {
  const nowSec = Math.floor(Date.now() / 1000);
  const { markets, usedFixtures, message } = await listMarkets(nowSec);
  const open = markets.filter((m) => m.status === "open");
  const featured = open.sort(
    (a, b) => (b.volume24hUsdc ?? 0) - (a.volume24hUsdc ?? 0),
  )[0];
  const closingSoon = [...open]
    .sort((a, b) => a.tradingCloseTs - b.tradingCloseTs)
    .slice(0, 6);

  return (
    <div className="container">
      {usedFixtures && message && (
        <div className="banner" style={{ marginBottom: "1rem", borderRadius: 8 }}>
          {message}
        </div>
      )}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)",
          gap: "1.5rem",
          alignItems: "start",
          marginBottom: "2.5rem",
        }}
        className="hero-grid"
      >
        <div>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", letterSpacing: "-0.03em", margin: "0 0 0.75rem" }}>
            Trade yes/no outcomes on stock prices.
          </h1>
          <p className="muted" style={{ fontSize: "1.05rem", maxWidth: 520 }}>
            Each contract pays 1.00 USDC if it&apos;s right at settlement. Prices reflect the
            market&apos;s implied odds. On Solana, priced by Pyth.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href="/markets">
              Browse markets
            </Link>
            <a className="btn" href="#how">
              How it works
            </a>
          </div>
        </div>
        <LandingClient featured={featured} />
      </section>

      <section id="how" style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "1rem" }}>How it works</h2>
        <div className="grid-3">
          <div className="card">
            <strong>1. Pick a market</strong>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              e.g. &quot;Will AAPL close ≥ $230 on Oct 16?&quot;
            </p>
          </div>
          <div className="card">
            <strong>2. Buy Yes or No</strong>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Pay the price, e.g. 0.62 USDC per contract.
            </p>
          </div>
          <div className="card">
            <strong>3. At settlement</strong>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Winning contracts pay 1.00 USDC; losing pay 0.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.15rem", margin: 0 }}>Closing soon</h2>
          <Link href="/markets?sort=close">View all</Link>
        </div>
        <LandingClient closingSoon={closingSoon} strip />
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ margin: 0 }}>{oneLineExplainer()}</p>
        <p className="muted" style={{ margin: "0.65rem 0 0", fontSize: "0.9rem" }}>
          One order book per market — No price = 1.00 − Yes price. Resolved by Pyth at a stated
          time. Hold one side per market in this app.
        </p>
      </section>

      <style>{`
        @media (max-width: 900px) {
          .hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
