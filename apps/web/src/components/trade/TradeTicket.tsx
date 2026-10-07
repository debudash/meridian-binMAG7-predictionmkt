"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Intent } from "@/lib/intents/types";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import { buyPreview, sellPreview, oneLineExplainer } from "@/lib/copy/payoff";
import { placePhoenixOrder } from "@/lib/phoenix/stub";
import { useTxStatus } from "@/components/providers/AppProviders";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import type { Perspective } from "@/lib/market/bookTransform";

const INTENTS: Intent[] = ["buy-yes", "sell-yes", "buy-no", "sell-no"];

function intentLabel(i: Intent): string {
  switch (i) {
    case "buy-yes":
      return "Buy Yes";
    case "sell-yes":
      return "Sell Yes";
    case "buy-no":
      return "Buy No";
    case "sell-no":
      return "Sell No";
  }
}

export function TradeTicket({
  market,
  perspective,
  initialIntent,
  initialPrice,
  initialSize,
  position = { yesQty: 0, noQty: 0 },
}: {
  market: MarketView;
  perspective: Perspective;
  initialIntent?: Intent;
  initialPrice?: number;
  initialSize?: number;
  position?: { yesQty: number; noQty: number };
}) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { push } = useTxStatus();
  const { nowSec } = useChainClock();
  const cd = getCountdown(market, nowSec);

  const defaultIntent: Intent =
    initialIntent ?? (perspective === "no" ? "buy-no" : "buy-yes");

  const [intent, setIntent] = useState<Intent>(defaultIntent);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState(initialSize ?? 10);
  const [price, setPrice] = useState(
    initialPrice ??
      (intent.includes("no")
        ? 1 - (market.yesAsk ?? market.yesMid ?? 0.5)
        : (market.yesAsk ?? market.yesMid ?? 0.5)),
  );
  const [busy, setBusy] = useState(false);

  const availability = useMemo(
    () =>
      getIntentAvailability(
        position,
        { openBuyYesQty: 0, openBuyNoQty: 0 },
        { pendingTradeCount: busy ? 1 : 0 },
        { lifecycle: cd.state, lotSize: market.lotSize },
      ),
    [position, busy, cd.state, market.lotSize],
  );

  const current = availability[intent];
  const isBuy = intent.startsWith("buy");
  const preview = isBuy
    ? buyPreview(size, price)
    : sellPreview(size, price);

  async function onSubmit() {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (!current.enabled) return;
    // Re-validate before signature (06 §2.5)
    const recheck = getIntentAvailability(
      position,
      { openBuyYesQty: 0, openBuyNoQty: 0 },
      { pendingTradeCount: 0 },
      { lifecycle: cd.state, lotSize: market.lotSize },
    );
    if (!recheck[intent].enabled) {
      push("error", recheck[intent].copy ?? "Intent not available");
      return;
    }

    setBusy(true);
    try {
      const result = await placePhoenixOrder({
        phoenixMarket: market.phoenixMarket ?? "unset",
        intent,
        price,
        size,
        orderType,
        worstPrice: orderType === "market" ? price + (isBuy ? 0.02 : -0.02) : undefined,
      });
      push(
        "neutral",
        `${result.message} Mapped: ${result.mapped.side} Yes @ ${result.mapped.yesPrice.toFixed(2)} × ${result.mapped.size}`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!cd.tradingEnabled) {
    return (
      <div className="card">
        <strong>Trading closed</strong>
        <p className="muted" style={{ marginTop: 8 }}>
          {cd.relativeLabel}
        </p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Redeem winning positions from Portfolio after settlement.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <strong>Order ticket</strong>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.4rem",
        }}
      >
        {INTENTS.map((i) => {
          const a = availability[i];
          return (
            <button
              key={i}
              type="button"
              className={`btn ${i.includes("yes") ? "btn-yes" : "btn-no"}`}
              disabled={!a.enabled}
              aria-pressed={intent === i}
              onClick={() => setIntent(i)}
              style={{
                outline: intent === i ? "2px solid var(--accent)" : undefined,
                opacity: a.enabled ? 1 : 0.45,
              }}
              title={a.copy}
            >
              {intentLabel(i)}
            </button>
          );
        })}
      </div>
      {!current.enabled && current.copy && (
        <div className="muted" style={{ fontSize: "0.82rem" }}>
          {current.copy}
          {current.cta && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8, padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}
              onClick={() => {
                setIntent(current.cta!.intent);
                if (current.cta!.size) setSize(current.cta!.size);
              }}
            >
              {current.cta.label}
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className="btn"
          aria-pressed={orderType === "market"}
          onClick={() => setOrderType("market")}
        >
          Market
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={orderType === "limit"}
          onClick={() => setOrderType("limit")}
        >
          Limit
        </button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
        Size (contracts)
        <input
          className="tabular"
          type="number"
          min={market.lotSize}
          step={market.lotSize}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.45rem 0.6rem",
            color: "var(--text)",
          }}
        />
      </label>

      {orderType === "limit" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
          Price
          <input
            className="tabular"
            type="number"
            min={market.minPrice}
            max={market.maxPrice}
            step={market.tickSize}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.45rem 0.6rem",
              color: "var(--text)",
            }}
          />
        </label>
      )}

      <div
        style={{
          background: "var(--bg)",
          borderRadius: 8,
          padding: "0.65rem",
          fontSize: "0.82rem",
          border: "1px solid var(--border)",
        }}
      >
        {preview}
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || (connected && !current.enabled)}
        onClick={onSubmit}
      >
        {!connected
          ? "Connect wallet"
          : busy
            ? "Confirm in your wallet…"
            : `${intentLabel(intent)} ${size}${orderType === "limit" ? ` @ ${price.toFixed(2)}` : ""}`}
      </button>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        {oneLineExplainer()}
      </p>
    </div>
  );
}
