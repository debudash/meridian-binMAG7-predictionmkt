"use client";

import type { MarketView } from "@/lib/market/types";

export function PositionPanel({
  market,
  yesQty = 0,
  noQty = 0,
}: {
  market: MarketView;
  yesQty?: number;
  noQty?: number;
}) {
  const settled =
    market.status === "settled-yes" ||
    market.status === "settled-no" ||
    market.status === "void";

  if (settled) {
    const wonYes = market.status === "settled-yes" && yesQty > 0;
    const wonNo = market.status === "settled-no" && noQty > 0;
    const qty = wonYes ? yesQty : wonNo ? noQty : 0;
    return (
      <div className="card">
        <strong>Redeem</strong>
        {qty > 0 ? (
          <p style={{ marginTop: 8 }}>
            Settled {market.outcome === "yes" ? "Yes" : "No"}. Your {qty}{" "}
            {wonYes ? "Yes" : "No"} → {(qty * 1).toFixed(2)} USDC.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            {yesQty + noQty > 0
              ? "Your side did not win. Payout 0.00 USDC."
              : "No position to redeem."}
          </p>
        )}
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          Use Portfolio → Redeemable to submit the on-chain <code>redeem</code> instruction.
        </p>
      </div>
    );
  }

  if (yesQty > 0 && noQty > 0) {
    return (
      <div className="card" style={{ borderColor: "var(--amber)" }}>
        <strong>Both sides held</strong>
        <p style={{ marginTop: 8, fontSize: "0.9rem" }}>
          You hold both Yes and No in this market — likely from another app. You can sell either
          side here; you can&apos;t add to either.
        </p>
        <p className="tabular">
          Yes {yesQty} · No {noQty}
        </p>
      </div>
    );
  }

  if (yesQty === 0 && noQty === 0) {
    return (
      <div className="card">
        <strong>Position</strong>
        <p className="muted" style={{ marginTop: 8 }}>
          No position. You can buy Yes or No.
        </p>
      </div>
    );
  }

  const side = yesQty > 0 ? "Yes" : "No";
  const qty = yesQty > 0 ? yesQty : noQty;
  const mark = market.yesMid ?? market.lastYes ?? 0;
  const sideMark = side === "Yes" ? mark : 1 - mark;

  return (
    <div className="card">
      <strong>
        {side} <span className="tabular">{qty}</span>
      </strong>
      <div className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
        Mark {sideMark.toFixed(2)} · Value {(qty * sideMark).toFixed(2)} USDC · Payout if right{" "}
        {(qty * 1).toFixed(2)} USDC
      </div>
      {side === "Yes" && (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
          Buy No unavailable while you hold Yes.
        </p>
      )}
      {side === "No" && (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
          Buy Yes unavailable while you hold No.
        </p>
      )}
    </div>
  );
}
