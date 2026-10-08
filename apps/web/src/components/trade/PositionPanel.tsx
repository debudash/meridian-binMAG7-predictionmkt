"use client";

import type { MarketView } from "@/lib/market/types";
import type { PhoenixSeatBalances } from "@/lib/portfolio/phoenixTrader";
import { WithdrawSeatButton } from "@/components/portfolio/PhoenixActions";

/**
 * Position = wallet Yes/No + Phoenix trader-account (seat) balances (DLV-087). Seat-free Yes is
 * yours (fills of resting bids) and counts as held; Withdraw moves it to the wallet.
 */
export function PositionPanel({
  market,
  yesQty: walletYes = 0,
  noQty = 0,
  seat = null,
  loading = false,
}: {
  market: MarketView;
  /** Wallet Yes */
  yesQty?: number;
  noQty?: number;
  seat?: PhoenixSeatBalances | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="card">
        <strong>Position</strong>
        <p className="muted" style={{ marginTop: 8 }}>Checking your balances…</p>
      </div>
    );
  }
  const seatYes = seat?.yesFree ?? 0;
  const yesQty = walletYes + seatYes;
  const seatCard =
    seat && market.phoenixMarket && (seat.yesFree > 0 || seat.usdcFree > 0 || seat.yesLocked > 0 || seat.usdcLocked > 0) ? (
      <SeatCard seat={seat} phoenixMarket={market.phoenixMarket} />
    ) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <PositionBody market={market} yesQty={yesQty} noQty={noQty} seatYes={seatYes} />
      {seatCard}
    </div>
  );
}

function SeatCard({ seat, phoenixMarket }: { seat: PhoenixSeatBalances; phoenixMarket: string }) {
  const free = seat.yesFree > 0 || seat.usdcFree > 0;
  return (
    <div className="card" style={{ padding: "0.6rem 0.8rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <strong style={{ fontSize: "0.9rem" }}>Phoenix trader account</strong>
          <div className="muted tabular" style={{ fontSize: "0.8rem", marginTop: 2 }}>
            Free {seat.yesFree} Yes · {seat.usdcFree.toFixed(2)} USDC — In orders {seat.yesLocked} Yes ·{" "}
            {seat.usdcLocked.toFixed(2)} USDC
          </div>
        </div>
        {free && <WithdrawSeatButton phoenixMarket={phoenixMarket} />}
      </div>
    </div>
  );
}

function PositionBody({
  market,
  yesQty,
  noQty,
  seatYes,
}: {
  market: MarketView;
  yesQty: number;
  noQty: number;
  seatYes: number;
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
      {side === "Yes" && seatYes > 0 && (
        <span className="muted tabular" style={{ fontSize: "0.8rem" }}>
          {" "}({seatYes} in Phoenix)
        </span>
      )}
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
