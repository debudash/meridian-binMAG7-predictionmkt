/**
 * One-line titles for blocked Buy buttons on compact surfaces (market cards,
 * table, ladder) — DLV-074. Full copy stays in the ticket (06 §2.3).
 */
import type { IntentAvailability, OpenOrdersSnapshot, PositionSnapshot } from "./types";

export function shortBuyBlockedTitle(
  side: "yes" | "no",
  a: IntentAvailability,
  position: PositionSnapshot,
  openOrders: OpenOrdersSnapshot = { openBuyYesQty: 0, openBuyNoQty: 0 },
  lotSize = 1,
): string | undefined {
  if (a.enabled) return undefined;
  const yesHeld = position.yesQty >= lotSize;
  const noHeld = position.noQty >= lotSize;
  switch (a.reason) {
    case "blocked":
      if (yesHeld && noHeld) return "You hold Yes and No — sell one side first";
      if (side === "no") {
        if (yesHeld) return "You hold Yes — sell it first";
        if (openOrders.openBuyYesQty > 0) return "Open Buy Yes orders — cancel them first";
      } else {
        if (noHeld) return "You hold No — sell it first";
        if (openOrders.openBuyNoQty > 0) return "Open Buy No orders — cancel them first";
      }
      return a.copy;
    case "pending":
      return "Waiting for your last order to confirm";
    case "market-closed":
      return a.copy ?? "Trading is closed for this market";
    default:
      return a.copy;
  }
}
