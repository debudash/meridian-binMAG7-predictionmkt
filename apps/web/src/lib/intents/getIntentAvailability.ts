/**
 * Pure intent availability — docs/ui/06 §2.5
 * Unit-tested against §2.1 matrix and key §2.4 edge cases.
 */
import type {
  Intent,
  IntentAvailability,
  IntentAvailabilityMap,
  MarketStateSnapshot,
  OpenOrdersSnapshot,
  PendingTxSnapshot,
  PositionSnapshot,
} from "./types";

const TRADING_LIFECYCLES = new Set(["open", "closing-soon"]);

function disabled(
  reason: string,
  copy?: string,
  cta?: IntentAvailability["cta"],
): IntentAvailability {
  return { enabled: false, reason, copy, cta };
}

function enabled(): IntentAvailability {
  return { enabled: true };
}

/**
 * Effective exposure for the Yes+No constraint (06 §2.2).
 * Dust below lotSize is treated as 0 for blocking (E4).
 */
export function getExposure(
  position: PositionSnapshot,
  openOrders: OpenOrdersSnapshot,
  lotSize = 1,
): { yesExposure: number; noExposure: number; yesHeld: number; noHeld: number } {
  const yesHeld = position.yesQty < lotSize ? 0 : position.yesQty;
  const noHeld = position.noQty < lotSize ? 0 : position.noQty;
  return {
    yesHeld,
    noHeld,
    yesExposure: yesHeld + openOrders.openBuyYesQty,
    noExposure: noHeld + openOrders.openBuyNoQty,
  };
}

export function getIntentAvailability(
  position: PositionSnapshot,
  openOrders: OpenOrdersSnapshot,
  pendingTxs: PendingTxSnapshot,
  marketState: MarketStateSnapshot,
): IntentAvailabilityMap {
  const lotSize = marketState.lotSize ?? 1;
  const { yesExposure, noExposure, yesHeld, noHeld } = getExposure(
    position,
    openOrders,
    lotSize,
  );

  const yesLocked = position.yesLockedInAsks ?? 0;
  const noLocked = position.noLockedInOrders ?? 0;
  const yesAvailable = Math.max(0, position.yesQty - yesLocked);
  const noAvailable = Math.max(0, position.noQty - noLocked);

  const both = yesHeld > 0 && noHeld > 0;
  const result: IntentAvailabilityMap = {
    "buy-yes": enabled(),
    "sell-yes": enabled(),
    "buy-no": enabled(),
    "sell-no": enabled(),
  };

  // E9 — market closed / settled / voided: all intents disabled
  if (!TRADING_LIFECYCLES.has(marketState.lifecycle)) {
    const copy =
      marketState.lifecycle === "settled" || marketState.lifecycle === "voided"
        ? "Market settled — use Redeem if you hold the winning side."
        : "Trading is closed for this market.";
    for (const intent of Object.keys(result) as Intent[]) {
      result[intent] = disabled("market-closed", copy);
    }
    return result;
  }

  // Pending tx locks ticket (06 §2.2 / §2.3)
  if (pendingTxs.pendingTradeCount > 0) {
    const copy = "Waiting for your last order to confirm…";
    for (const intent of Object.keys(result) as Intent[]) {
      result[intent] = disabled("pending", copy);
    }
    return result;
  }

  // Sell Yes
  if (yesAvailable <= 0) {
    result["sell-yes"] = disabled("nothing-to-sell");
  }

  // Sell No
  if (noAvailable <= 0) {
    result["sell-no"] = disabled("nothing-to-sell");
  }

  // Legacy both sides (E7/E8): can sell either; cannot add to either
  if (both) {
    result["buy-yes"] = disabled(
      "blocked",
      "You hold both Yes and No in this market — likely from another app. You can sell either side here; you can't add to either.",
    );
    result["buy-no"] = disabled(
      "blocked",
      "You hold both Yes and No in this market — likely from another app. You can sell either side here; you can't add to either.",
    );
    return result;
  }

  // Buy No blocked by Yes exposure
  if (yesExposure > 0) {
    if (openOrders.openBuyYesQty > 0 && yesHeld === 0) {
      result["buy-no"] = disabled(
        "blocked",
        `You have open Buy Yes orders (${openOrders.openBuyYesQty} contracts). Cancel them before buying No.`,
        { label: "Cancel orders", intent: "buy-yes" },
      );
    } else {
      const qty = yesHeld || yesExposure;
      result["buy-no"] = disabled(
        "blocked",
        `You hold ${qty} Yes in this market. Close your Yes position before buying No.`,
        {
          label: `Sell ${qty} Yes`,
          intent: "sell-yes",
          size: qty,
        },
      );
    }
  }

  // Buy Yes blocked by No exposure
  if (noExposure > 0) {
    if (openOrders.openBuyNoQty > 0 && noHeld === 0) {
      result["buy-yes"] = disabled(
        "blocked",
        `You have open Buy No orders (${openOrders.openBuyNoQty} contracts). Cancel them before buying Yes.`,
        { label: "Cancel orders", intent: "buy-no" },
      );
    } else {
      const qty = noHeld || noExposure;
      result["buy-yes"] = disabled(
        "blocked",
        `You hold ${qty} No in this market. Close your No position before buying Yes.`,
        {
          label: `Sell ${qty} No`,
          intent: "sell-no",
          size: qty,
        },
      );
    }
  }

  return result;
}
