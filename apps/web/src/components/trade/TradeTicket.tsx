"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import type { Intent } from "@/lib/intents/types";
import type { IntentAvailabilityMap, PositionSnapshot } from "@/lib/intents/types";
import { getIntentAvailability } from "@/lib/intents/getIntentAvailability";
import { oneLineExplainer } from "@/lib/copy/payoff";
import { whatIfPayoff } from "@/lib/copy/whatIf";
import { DistanceReadout } from "@/components/trade/DistanceReadout";
import type { UnderlyingQuote } from "@/hooks/useUnderlyingPrice";
import {
  isPhoenixPlacementEnabled,
  placePhoenixOrder,
  pausedCopyForFailedPlace,
  PHOENIX_NOT_CONFIGURED_MESSAGE,
  SELL_NO_MERGE_CAVEAT,
  planIntentComposition,
  ticketPhoenixOrderType,
} from "@/lib/phoenix";
import { useTxStatus } from "@/components/providers/AppProviders";
import type { MarketView, OrderBookSnapshot } from "@/lib/market/types";
import { getCountdown } from "@/lib/market/countdown";
import { useChainClock } from "@/components/providers/AppProviders";
import type { Perspective } from "@/lib/market/bookTransform";
import { useTradingBlockedByBanner } from "@/components/layout/GlobalBanners";
import { getUsdcMint } from "@/lib/solana/config";
import { getMeridianProgram } from "@/lib/solana/program";
import type { MintAccounts } from "@/lib/solana/instructions";
import { explorerTx } from "@/lib/solana/config";
import { lotSizeError } from "@/lib/phoenix/size";
import { sweepDisclosure } from "@/lib/phoenix/sweepCopy";
import { marketWorstPrice } from "@/lib/phoenix/compose";
import { confirmSignature, toastForConfirm } from "@/lib/solana/confirm";

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
  liveBook,
  usdcBalance,
  onTicketChange,
  underlying,
  seatFree,
  onRetryBalances,
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
  /** Live Phoenix ladder (Yes terms) — drives market-order touch price */
  liveBook?: OrderBookSnapshot | null;
  /** Connected wallet USDC (live) */
  usdcBalance?: number;
  /** Reports intent/price/orderType so the book can highlight the matching level (DLV-071). */
  onTicketChange?: (s: { intent: Intent; price: number; orderType: "market" | "limit" }) => void;
  /** Live underlying (mock Pyth on localnet / Pyth) for the distance-to-strike readout. */
  underlying?: UnderlyingQuote | null;
  /** Free Yes / USDC in this wallet's Phoenix seat — swept to the wallet with the next order (L11) */
  seatFree?: { yesFree: number; usdcFree: number } | null;
  /** Re-read balances after a failed first read (M5) */
  onRetryBalances?: () => void;
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
  // Post-only is hidden in V1 (D-021, simplification per Debu): no checkbox, always
  // sent as false via ticketPhoenixOrderType. The Phoenix post-only path stays for later.
  const [size, setSize] = useState(initialSize ?? 10);
  const [price, setPrice] = useState(
    initialPrice ??
      (intent.includes("no")
        ? 1 - (market.yesAsk ?? market.yesMid ?? 0.5)
        : (market.yesAsk ?? market.yesMid ?? 0.5)),
  );
  const [busy, setBusy] = useState(false);

  /** Touch price in the intent's own terms (Yes for Yes intents, No for No intents). */
  const touchPrice = useMemo(() => {
    const bestBid = liveBook?.bids[0]?.price ?? market.yesBid;
    const bestAsk = liveBook?.asks[0]?.price ?? market.yesAsk;
    const r = (x: number) => Math.round(x * 100) / 100;
    switch (intent) {
      case "buy-yes":
        return bestAsk;
      case "sell-yes":
        return bestBid;
      case "buy-no":
        return bestBid != null ? r(1 - bestBid) : undefined;
      case "sell-no":
        return bestAsk != null ? r(1 - bestAsk) : undefined;
    }
  }, [intent, liveBook, market.yesBid, market.yesAsk]);

  // Switching intent re-anchors price to that side's touch (Yes vs No terms differ);
  // market orders keep following the live book.
  const [anchoredIntent, setAnchoredIntent] = useState<Intent | null>(null);
  useEffect(() => {
    if (touchPrice == null) return;
    if (orderType === "market" || anchoredIntent !== intent) {
      setPrice(touchPrice);
      setAnchoredIntent(intent);
    }
  }, [touchPrice, intent, orderType, anchoredIntent]);

  const intentRef = useRef(intent);
  intentRef.current = intent;
  useEffect(() => {
    if (fillPrice == null) return;
    setOrderType("limit");
    setPrice(fillPrice);
    const nextIntent = fillIntentHint ?? intentRef.current;
    setIntent(nextIntent);
    // Mark the book-clicked price as this intent's anchor so the touch re-anchor
    // above doesn't overwrite it when the click also switches intent.
    setAnchoredIntent(nextIntent);
    onConsumedFill?.();
  }, [fillPrice, fillIntentHint, onConsumedFill]);

  useEffect(() => {
    onTicketChange?.({ intent, price, orderType });
  }, [intent, price, orderType, onTicketChange]);

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
  // M1: whole lots only — Phoenix floors to lots while the mint uses the exact size.
  const lotSize = market.lotSize ?? 1;
  const sizeError = lotSizeError(size, lotSize);
  // L8: worst price clamped to the market's price band (Buy No at p_no ≥ 0.98 used to give Yes ≤ 0).
  const worstPrice =
    orderType === "market"
      ? marketWorstPrice(touchPrice ?? price, isBuy, { minPrice: market.minPrice, maxPrice: market.maxPrice })
      : undefined;
  // L11: the order tx also withdraws free seat funds to the wallet — say so.
  const sweepLine = phoenixReady ? sweepDisclosure(seatFree) : null;
  // What-if payoff (DLV-075): Market → live best price in the intent's terms; Limit → typed price.
  const effectivePrice = orderType === "market" ? touchPrice : price;
  const whenShort = new Date(market.settleTs * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const whatIf =
    effectivePrice != null
      ? whatIfPayoff({
          intent,
          size,
          price: effectivePrice,
          symbol: market.underlyingSymbol,
          strike: market.strike,
          whenShort,
        })
      : null;

  const planPreview = useMemo(
    () =>
      planIntentComposition({
        intent,
        price,
        size,
        orderType: ticketPhoenixOrderType(orderType),
        tickSize: market.tickSize,
      }),
    [intent, price, size, orderType, market.tickSize],
  );

  function ctaLabel(): string {
    if (!connected) return "Connect wallet";
    if (busy) {
      return phoenixReady ? "Confirm in your wallet…" : "Working…";
    }
    if (!phoenixReady) {
      return `Phoenix not configured — ${intentLabel(intent)}`;
    }
    return `${intentLabel(intent)} ${size}${orderType === "limit" ? ` @ ${price.toFixed(2)}` : ""}`;
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
    if (sizeError) {
      push("error", sizeError);
      return;
    }
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
      const phoenixType = ticketPhoenixOrderType(orderType);

      let mintAccounts: MintAccounts | undefined;
      let program: ReturnType<typeof getMeridianProgram> | undefined;
      const needsMeridianAccounts =
        planPreview.needsMint || (planPreview.needsMerge && !planPreview.mergeBlocked);
      if (needsMeridianAccounts && publicKey && anchorWallet) {
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
          lotSize,
          orderType: phoenixType,
          tickSize: market.tickSize,
          worstPrice,
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
        if (typeof window !== "undefined") {
          console.info("explorer", explorerTx(result.signature));
        }
        // L14: success only once the tx confirmed without error.
        push("info", "Submitted — confirming…");
        const outcome = await confirmSignature(connection, result.signature, result.blockhash);
        // The expiry pause can land between simulation and confirmation (!73).
        const paused =
          outcome.status === "failed"
            ? await pausedCopyForFailedPlace(connection, market.phoenixMarket, outcome.error)
            : null;
        if (paused) {
          push("error", paused);
        } else {
          const swept = result.swept ? sweepDisclosure(seatFree, "past") : null;
          const t = toastForConfirm(outcome, swept ? `${result.message} ${swept}` : result.message, result.signature);
          push(t.kind, t.message);
        }
      } else if (result.reason === "invalid-size") {
        push("error", result.message);
      } else if (result.reason === "not-configured") {
        push("neutral", result.message);
      } else if (result.reason === "merge-schema-todo") {
        push("neutral", result.message);
      } else if (result.reason === "market-paused") {
        // Book paused at expiry: "Market paused, cancel or withdraw only" (cancel/withdraw live in Portfolio).
        push("error", result.message);
      } else if (result.reason === "no-fill" || result.reason === "program-error") {
        // Plain copy from explainPlaceError (D-024) — nothing was traded.
        push("error", result.message);
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
        role="group"
        aria-label="Order intent"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.5rem",
        }}
      >
        {INTENTS.map((i) => {
          const a = availability[i];
          const enabled = a.enabled && !tradingBlocked;
          return (
            <button
              key={i}
              type="button"
              className={`btn choice ${i.includes("yes") ? "btn-yes" : "btn-no"}`}
              disabled={!enabled}
              aria-pressed={intent === i}
              onClick={() => setIntent(i)}
              title={a.copy ?? (enabled ? undefined : "Unavailable")}
            >
              {intentLabel(i)}
            </button>
          );
        })}
      </div>
      {!current.enabled && current.copy && (
        <div className="muted" style={{ fontSize: "0.82rem" }}>
          {current.copy}
          {current.reason === "balances-error" && onRetryBalances && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 8, padding: "0.2rem 0.5rem", fontSize: "0.8rem" }}
              onClick={onRetryBalances}
            >
              Retry
            </button>
          )}
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

      <div
        role="group"
        aria-label="Order type"
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}
      >
        <button
          type="button"
          className="btn"
          aria-pressed={orderType === "market"}
          onClick={() => {
            setOrderType("market");
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

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem" }}>
        Size (contracts)
        <input
          className="tabular"
          type="number"
          min={lotSize}
          step={lotSize}
          value={size}
          aria-invalid={sizeError ? true : undefined}
          aria-describedby={sizeError ? "ticket-size-error" : undefined}
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
      {sizeError && (
        <p id="ticket-size-error" role="alert" style={{ color: "var(--danger)", fontSize: "0.78rem", margin: 0 }}>
          {sizeError}
        </p>
      )}

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
        <p className="tabular" data-testid="whatif-line" style={{ margin: 0, lineHeight: 1.4 }}>
          {whatIf
            ? whatIf.sentence
            : orderType === "market"
              ? "No live price on the book for a market order yet."
              : "Enter a size and a price between 0.01 and 0.99."}
        </p>
        <DistanceReadout market={market} underlying={underlying} />
        {planPreview.needsMint && (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            Buy No: mint pair then ask Yes @ {planPreview.yesPrice.toFixed(2)} (multi-ix tx).
          </p>
        )}
        {planPreview.needsMerge && !planPreview.mergeBlocked && (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            Sell No (market): bid Yes then merge_pair in one tx.
          </p>
        )}
        {planPreview.mergeBlocked && (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            Sell No (resting): bid Yes only — merge_pair on fill not automatic yet.
          </p>
        )}
        {sweepLine && (
          <p className="muted" data-testid="sweep-line" style={{ margin: "0.4rem 0 0", fontSize: "0.75rem" }}>
            {sweepLine}
          </p>
        )}
      </div>

      {!phoenixReady && (
        <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
          {PHOENIX_NOT_CONFIGURED_MESSAGE}
        </p>
      )}

      {connected && phoenixReady && (
        <p className="muted tabular" style={{ fontSize: "0.75rem", margin: 0 }}>
          {orderType === "market" && touchPrice != null
            ? `Market fills at best ${intent.includes("no") ? "No" : "Yes"} ${touchPrice.toFixed(2)} (up to ${(worstPrice ?? touchPrice).toFixed(2)}). `
            : ""}
          {usdcBalance != null ? `Wallet USDC ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || tradingBlocked || (connected && (!current.enabled || sizeError != null))}
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
