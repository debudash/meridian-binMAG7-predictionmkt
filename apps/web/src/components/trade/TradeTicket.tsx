"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import type { Intent } from "@/lib/intents/types";
import type { IntentAvailabilityMap, PositionSnapshot } from "@/lib/intents/types";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import { buyPreview, sellPreview, oneLineExplainer } from "@/lib/copy/payoff";
import {
  isPhoenixPlacementEnabled,
  placePhoenixOrder,
  PHOENIX_NOT_CONFIGURED_MESSAGE,
  SELL_NO_MERGE_CAVEAT,
  planIntentComposition,
} from "@/lib/phoenix";
import { useTxStatus } from "@/components/providers/AppProviders";
import type { MarketView } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import type { Perspective } from "@/lib/market/bookTransform";
import { useTradingBlockedByBanner } from "@/components/layout/GlobalBanners";
import { getUsdcMint } from "@/lib/solana/config";
import { getMeridianProgram } from "@/lib/solana/program";
import type { MintAccounts } from "@/lib/solana/instructions";
import { explorerTx } from "@/lib/solana/config";

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
  availability: availabilityProp,
  openOrders = { openBuyYesQty: 0, openBuyNoQty: 0 },
  fillPrice,
  fillIntentHint,
  onConsumedFill,
}: {
  market: MarketView;
  perspective: Perspective;
  initialIntent?: Intent;
  initialPrice?: number;
  initialSize?: number;
  position?: PositionSnapshot;
  availability?: IntentAvailabilityMap;
  openOrders?: { openBuyYesQty: number; openBuyNoQty: number };
  /** Book click fill */
  fillPrice?: number | null;
  fillIntentHint?: Intent | null;
  onConsumedFill?: () => void;
}) {
  const { connected, publicKey, sendTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { push } = useTxStatus();
  const { nowSec } = useChainClock();
  const tradingBlocked = useTradingBlockedByBanner();
  const cd = getCountdown(market, nowSec);

  const phoenixReady = isPhoenixPlacementEnabled(market.phoenixMarket);

  const defaultIntent: Intent =
    initialIntent ?? (perspective === "no" ? "buy-no" : "buy-yes");

  const [intent, setIntent] = useState<Intent>(defaultIntent);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [postOnly, setPostOnly] = useState(false);
  const [size, setSize] = useState(initialSize ?? 10);
  const [price, setPrice] = useState(
    initialPrice ??
      (intent.includes("no")
        ? 1 - (market.yesAsk ?? market.yesMid ?? 0.5)
        : (market.yesAsk ?? market.yesMid ?? 0.5)),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fillPrice == null) return;
    setOrderType("limit");
    setPrice(fillPrice);
    if (fillIntentHint) {
      setIntent(fillIntentHint);
    }
    onConsumedFill?.();
  }, [fillPrice, fillIntentHint, onConsumedFill]);

  const availability = useMemo(() => {
    if (availabilityProp) return availabilityProp;
    return getIntentAvailability(
      position,
      openOrders,
      { pendingTradeCount: busy ? 1 : 0 },
      { lifecycle: cd.state, lotSize: market.lotSize },
    );
  }, [availabilityProp, position, openOrders, busy, cd.state, market.lotSize]);

  const current = availability[intent];
  const isBuy = intent.startsWith("buy");
  const preview = isBuy ? buyPreview(size, price) : sellPreview(size, price);

  const planPreview = useMemo(
    () =>
      planIntentComposition({
        intent,
        price,
        size,
        orderType: orderType === "limit" && postOnly ? "post-only" : orderType,
        tickSize: market.tickSize,
      }),
    [intent, price, size, orderType, postOnly, market.tickSize],
  );

  function ctaLabel(): string {
    if (!connected) return "Connect wallet";
    if (busy) {
      return phoenixReady ? "Confirm in your wallet…" : "Working…";
    }
    if (!phoenixReady) {
      return `Phoenix not configured — ${intentLabel(intent)}`;
    }
    return `${intentLabel(intent)} ${size}${orderType === "limit" ? ` @ ${price.toFixed(2)}` : ""}${postOnly && orderType === "limit" ? " (post-only)" : ""}`;
  }

  async function onSubmit() {
    if (!connected) {
      setVisible(true);
      return;
    }
    if (tradingBlocked) {
      push("error", "Trading blocked by cluster or program pause.");
      return;
    }
    if (!current.enabled) return;
    const recheck = getIntentAvailability(
      position,
      openOrders,
      { pendingTradeCount: 0 },
      { lifecycle: cd.state, lotSize: market.lotSize },
    );
    if (!recheck[intent].enabled) {
      push("error", recheck[intent].copy ?? "Intent not available");
      return;
    }

    if (!phoenixReady) {
      push(
        "neutral",
        `${PHOENIX_NOT_CONFIGURED_MESSAGE} Mapped: ${planPreview.phoenixSide} Yes @ ${planPreview.yesPrice.toFixed(2)} × ${planPreview.size}`,
      );
      return;
    }

    setBusy(true);
    try {
      const phoenixType =
        orderType === "limit" && postOnly ? "post-only" : orderType;

      let mintAccounts: MintAccounts | undefined;
      let program: ReturnType<typeof getMeridianProgram> | undefined;
      if (planPreview.needsMint && publicKey && anchorWallet) {
        const usdc = getUsdcMint();
        if (
          market.yesMint &&
          market.noMint &&
          usdc &&
          market.collateralVault &&
          market.treasury
        ) {
          const provider = new AnchorProvider(connection, anchorWallet, {
            commitment: "confirmed",
          });
          program = getMeridianProgram(provider);
          mintAccounts = {
            user: publicKey,
            strikeMarket: new PublicKey(market.marketId),
            collateralVault: new PublicKey(market.collateralVault),
            yesMint: new PublicKey(market.yesMint),
            noMint: new PublicKey(market.noMint),
            treasury: new PublicKey(market.treasury),
            collateralMint: usdc,
          };
        }
      }

      const result = await placePhoenixOrder(
        {
          phoenixMarket: market.phoenixMarket ?? "unset",
          intent,
          price,
          size,
          orderType: phoenixType,
          tickSize: market.tickSize,
          worstPrice:
            orderType === "market" ? price + (isBuy ? 0.02 : -0.02) : undefined,
          strikeMarket: market.marketId,
          yesMint: market.yesMint,
          noMint: market.noMint,
        },
        publicKey
          ? {
              connection,
              publicKey,
              sendTransaction,
              program,
              mintAccounts,
              ensureSeat: true,
            }
          : undefined,
      );

      if (result.ok && result.signature) {
        push(
          "success",
          `${result.message} Tx: ${result.signature.slice(0, 8)}…`,
        );
        if (typeof window !== "undefined") {
          console.info("explorer", explorerTx(result.signature));
        }
      } else if (result.reason === "not-configured") {
        push("neutral", result.message);
      } else if (result.reason === "merge-schema-todo") {
        push("neutral", result.message);
      } else {
        const tone = result.ok ? "success" : result.reason === "user-rejected" ? "neutral" : "error";
        push(
          tone,
          `${result.message} Mapped: ${result.mapped.side} Yes @ ${result.mapped.yesPrice.toFixed(2)} × ${result.mapped.size}`,
        );
      }
      if (intent === "sell-no" && result.plan?.mergeBlocked) {
        push("neutral", SELL_NO_MERGE_CAVEAT);
      }
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
          const enabled = a.enabled && !tradingBlocked;
          return (
            <button
              key={i}
              type="button"
              className={`btn ${i.includes("yes") ? "btn-yes" : "btn-no"}`}
              disabled={!enabled}
              aria-pressed={intent === i}
              onClick={() => setIntent(i)}
              style={{
                outline: intent === i ? "2px solid var(--accent)" : undefined,
                opacity: enabled ? 1 : 0.45,
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

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="btn"
          aria-pressed={orderType === "market"}
          onClick={() => {
            setOrderType("market");
            setPostOnly(false);
          }}
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

      {orderType === "limit" && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.85rem",
          }}
        >
          <input
            type="checkbox"
            checked={postOnly}
            onChange={(e) => setPostOnly(e.target.checked)}
          />
          Post only
        </label>
      )}

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
        {planPreview.needsMint && (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            Buy No: mint pair then ask Yes @ {planPreview.yesPrice.toFixed(2)} (multi-ix tx).
          </p>
        )}
        {planPreview.mergeBlocked && (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            Sell No: bid Yes only — full merge awaits Schema.
          </p>
        )}
      </div>

      {!phoenixReady && (
        <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
          {PHOENIX_NOT_CONFIGURED_MESSAGE}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || tradingBlocked || (connected && !current.enabled)}
        onClick={onSubmit}
      >
        {ctaLabel()}
      </button>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        {oneLineExplainer()}
      </p>
    </div>
  );
}
