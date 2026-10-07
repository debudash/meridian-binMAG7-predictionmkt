/**
 * Compatibility shim — real placement lives in ./client.
 * When Phoenix is not configured, placePhoenixOrder returns structured not-configured
 * (ok:false), never fake success.
 */
export {
  placePhoenixOrder,
  fetchPhoenixBook,
  isPhoenixPlacementEnabled,
  PHOENIX_NOT_CONFIGURED_MESSAGE,
  SELL_NO_MERGE_CAVEAT,
  planIntentComposition,
} from "./index";
export type {
  PhoenixPlaceOrderRequest,
  PhoenixPlaceOrderResult,
  ComposePlanSummary,
} from "./types";

export const PHOENIX_STUB_NOTICE =
  "Phoenix market not configured — orders are not submitted. Set a phoenixMarket pubkey and optionally NEXT_PUBLIC_PHOENIX_ENABLED=true.";
