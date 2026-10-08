"use client";

/**
 * Settle replay proof (DLV-076): Pyth settlement price vs strike, outcome, settle time,
 * links to the settle tx + price account + feed id. Data = StrikeMarket state +
 * Settled/AdminSettled event from the settle tx logs (no program change, D-023).
 */
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { MarketView } from "@/lib/market/types";
import { buildSettleProof, money } from "@/lib/settle/proof";
import { fetchSettleTx, type SettleTxLookup } from "@/lib/settle/fetchProof";
import { explorerAddress, explorerTx } from "@/lib/solana/config";
import { truncateAddress } from "@/lib/format";

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd className="tabular" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {children}
      </dd>
    </>
  );
}

export function SettleProofCard({ market }: { market: MarketView }) {
  const { connection } = useConnection();
  const [lookup, setLookup] = useState<SettleTxLookup | null>(null);
  const [loading, setLoading] = useState(market.status === "settled-yes" || market.status === "settled-no");

  useEffect(() => {
    if (market.status !== "settled-yes" && market.status !== "settled-no") return;
    let cancelled = false;
    setLoading(true);
    fetchSettleTx(connection, market)
      .then((r) => {
        if (!cancelled) setLookup(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, market]);

  const proof = buildSettleProof({
    market,
    event: lookup?.event,
    signature: lookup?.signature,
    blockTime: lookup?.blockTime,
    feedExpo: lookup?.feedExpo,
    mockFeed: lookup?.mockFeed,
    lookupDone: !loading,
    explorerTx,
    explorerAddress,
  });

  if (proof.status === "settling") {
    return (
      <section className="card settle-proof" data-testid="settle-proof">
        <strong>Settlement in progress</strong>
        <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          Waiting for the Pyth settle transaction. The proof appears here once it lands.
        </p>
      </section>
    );
  }
  if (proof.status === "void") {
    return (
      <section className="card settle-proof" data-testid="settle-proof">
        <strong>Market voided</strong>
        <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          No outcome was recorded; collateral is returned per the void rule.
        </p>
      </section>
    );
  }

  const winner = proof.outcome === "yes" ? "Yes" : "No";
  const confLabel =
    proof.kind === "admin"
      ? "n/a (admin settle)"
      : proof.conf != null
        ? `± ${money(proof.conf)}`
        : proof.confRaw != null
          ? `${proof.confRaw.toString()} (raw)`
          : loading
            ? "…"
            : "—";

  return (
    <section
      className="card settle-proof"
      data-testid="settle-proof"
      aria-label="Settlement proof"
      style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong>Settlement proof</strong>
        <span className={`chip ${proof.outcome === "yes" ? "chip-yes" : "chip-no"}`}>{winner} wins</span>
      </div>
      {proof.comparisonLine && (
        <div className="tabular" style={{ fontSize: "1.05rem", fontWeight: 650 }} data-testid="settle-comparison">
          {proof.symbol} {proof.comparisonLine.replace(/ → .*/, "")}{" "}
          <span style={{ color: proof.outcome === "yes" ? "var(--yes)" : "var(--no)" }}>
            → {winner} wins
          </span>
        </div>
      )}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          gap: "0.3rem 0.9rem",
          margin: 0,
          fontSize: "0.83rem",
        }}
      >
        <Row label="Settlement price">
          {proof.settlementPrice != null ? money(proof.settlementPrice) : "—"}{" "}
          <span className="muted">
            {proof.kind === "admin" ? "admin fallback" : lookup?.mockFeed ? "mock Pyth (localnet)" : "Pyth"}
          </span>
        </Row>
        <Row label="Confidence">{confLabel}</Row>
        <Row label="Strike">
          {money(proof.strike)} <span className="muted">(Yes if ≥, D-005)</span>
        </Row>
        <Row label="Settled at">
          {proof.settledAt ? fmtTime(proof.settledAt) : "—"}
          {proof.settledSlot ? <span className="muted"> · slot {proof.settledSlot}</span> : null}
        </Row>
        <Row label="Settle tx">
          {proof.signature && proof.links.txUrl ? (
            <a href={proof.links.txUrl} target="_blank" rel="noopener noreferrer" data-testid="settle-tx-link">
              {truncateAddress(proof.signature, 8, 8)} ↗
            </a>
          ) : loading ? (
            "Looking up…"
          ) : (
            "not found in RPC history"
          )}
        </Row>
        <Row label="Pyth feed id">
          {proof.feedIdHex ? (
            proof.links.feedUrl ? (
              <a href={proof.links.feedUrl} target="_blank" rel="noopener noreferrer">
                0x{truncateAddress(proof.feedIdHex, 6, 6)} ↗
              </a>
            ) : (
              <span title={`0x${proof.feedIdHex}`}>
                0x{truncateAddress(proof.feedIdHex, 6, 6)}{" "}
                {lookup?.mockFeed && <span className="muted">(mock)</span>}
              </span>
            )
          ) : (
            "—"
          )}
          {proof.priceAccount && proof.links.priceAccountUrl && (
            <>
              {" · "}
              <a href={proof.links.priceAccountUrl} target="_blank" rel="noopener noreferrer">
                price account {truncateAddress(proof.priceAccount)} ↗
              </a>
            </>
          )}
        </Row>
      </dl>
      {proof.notes.length > 0 && (
        <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.75rem" }}>
          {proof.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
