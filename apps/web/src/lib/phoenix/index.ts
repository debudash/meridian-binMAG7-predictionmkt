/**
 * Phoenix CLOB integration — Yes/USDC book (D-015).
 * Prefer placePhoenixOrder from here (not stub).
 */
export {
  isPhoenixPlacementEnabled,
  isPhoenixExplicitlyDisabled,
  hasPhoenixMarketPubkey,
  PHOENIX_NOT_CONFIGURED_MESSAGE,
  SELL_NO_MERGE_CAVEAT,
} from "./config";
export {
  planIntentComposition,
  snapYesPrice,
  displayNoPrice,
  effectiveYesLimitPrice,
  isImmediateFillOrder,
  ticketPhoenixOrderType,
  POST_ONLY_ENABLED,
} from "./compose";
export { placePhoenixOrder, fetchPhoenixBook } from "./client";
export { buildClaimSeatInstructions } from "./seat";
export {
  contractsToRawAmounts,
  DEFAULT_OUTCOME_DECIMALS,
} from "./size";
export type { ContractSizeRaw } from "./size";
export type {
  PhoenixPlaceOrderRequest,
  PhoenixPlaceOrderResult,
  ComposePlanSummary,
  PlaceFailureReason,
  PhoenixOrderType,
} from "./types";
export type { PlaceContext } from "./client";

/** @deprecated Use placePhoenixOrder; kept for import compatibility. */
export { placePhoenixOrder as placePhoenixOrderLegacy } from "./client";
