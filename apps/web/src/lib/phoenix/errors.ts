/**
 * Plain-language copy for failed order transactions (D-024 / DLV-070).
 * Market orders are fill-or-kill at the worst price, so "no fill" is a normal, safe outcome.
 */
import meridianProd from "@/idl/meridian.prod.json";
import type { Intent } from "@/lib/intents/types";
import type { PlaceFailureReason } from "./types";

/** Phoenix V1 `NewOrderError` — IOC could not reach min_base_lots_to_fill. */
export const PHOENIX_NEW_ORDER_ERROR = 0xf;

/**
 * Books are paused at expiry (PSM ChangeMarketStatus(Paused), !73). Phoenix then refuses new
 * orders / crosses but still allows cancel (reduce) and WithdrawFunds.
 */
export const PHOENIX_MARKET_PAUSED_MESSAGE = "Market paused, cancel or withdraw only";
/** Phoenix MarketStatus::Paused (MarketHeader.status u64 @8). */
export const PHOENIX_STATUS_PAUSED = 3;

/**
 * Phoenix V1 fails place/cross on a Paused book with ProgramError::InvalidAccountData and logs one of
 *   "Post only order is not allowed, market status is Paused"   (PlaceLimitOrder: limit / post-only)
 *   "FOK and IOC orders are not allowed, market status is Paused" (Swap: market IOC/FOK)
 *   "Market is not active, market status is Paused"             (order packet that withdraws)
 * (phoenix-v1 phoenix_checkers.rs / new_order.rs; asserted against the real program by
 * apps/automation/test/phoenix-pause.localnet.test.ts).
 */
const PHOENIX_PAUSED_LOG = /market status is Paused\b/;

export function isPhoenixMarketPausedError(text: string): boolean {
  return PHOENIX_PAUSED_LOG.test(text);
}

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
  if (isPhoenixMarketPausedError(msg)) {
    return { reason: "market-paused", message: PHOENIX_MARKET_PAUSED_MESSAGE };
  }
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
