/**
 * Plain-language copy for failed order transactions (D-024 / DLV-070).
 * Market orders are fill-or-kill at the worst price, so "no fill" is a normal, safe outcome.
 */
import meridianProd from "@/idl/meridian.prod.json";
import type { Intent } from "@/lib/intents/types";
import type { PlaceFailureReason } from "./types";

/** Phoenix V1 `NewOrderError` — IOC could not reach min_base_lots_to_fill. */
export const PHOENIX_NEW_ORDER_ERROR = 0xf;

const MERIDIAN_ERRORS: Record<number, string> = Object.fromEntries(
  ((meridianProd as { errors?: { code: number; msg?: string; name: string }[] }).errors ?? []).map((e) => [
    e.code,
    e.msg ?? e.name,
  ]),
);

const FRIENDLY: Record<string, string> = {
  Paused: "Trading is paused by the operator. Nothing was traded.",
  MarketNotOpen: "This market is no longer open. Nothing was traded.",
  MintAfterExpiry: "This market has expired — new contracts can't be created. Nothing was traded.",
  TradingClosed: "Trading is closed for this market. Nothing was traded.",
};

export interface PlaceErrorContext {
  intent: Intent;
  orderType: string;
  size: number;
  worstPrice?: number;
}

function customCode(msg: string): number | null {
  const m = msg.match(/custom program error: 0x([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) : null;
}

export function explainPlaceError(
  msg: string,
  ctx: PlaceErrorContext,
): { reason: PlaceFailureReason; message: string } | null {
  const code = customCode(msg);
  if (code == null) return null;
  if (code >= 6000) {
    const entry = (meridianProd as { errors?: { code: number; name: string }[] }).errors?.find((e) => e.code === code);
    const text = (entry && FRIENDLY[entry.name]) ?? MERIDIAN_ERRORS[code];
    if (text) return { reason: "program-error", message: text };
    return null;
  }
  if (code === PHOENIX_NEW_ORDER_ERROR && ctx.orderType === "market") {
    const side = ctx.intent.endsWith("yes") ? "Yes" : "No";
    const limit = ctx.worstPrice != null ? ` at ${ctx.worstPrice.toFixed(2)} or better` : " within your price limit";
    return {
      reason: "no-fill",
      message: `No fill: the book doesn't have ${ctx.size} ${side}${limit}. Nothing was traded — try a smaller size or a Limit order.`,
    };
  }
  return null;
}
