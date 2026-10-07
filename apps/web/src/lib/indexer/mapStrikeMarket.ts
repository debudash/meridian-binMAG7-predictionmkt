/**
 * Map on-chain StrikeMarket account → MarketView (types.ts).
 */
import { PublicKey } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import { settleStatusLabel } from "@/lib/market/status";

function decodeSymbol(raw: number[] | Uint8Array | Buffer): string {
  const buf = Buffer.from(raw);
  return buf.toString("utf8").replace(/\0/g, "").trim();
}

function pkStr(v: PublicKey | string | { toBase58?: () => string }): string {
  if (typeof v === "string") return v;
  if (v && typeof (v as PublicKey).toBase58 === "function") {
    return (v as PublicKey).toBase58();
  }
  return String(v);
}

export interface RawStrikeMarket {
  marketId?: { toString?: () => string } | number | bigint;
  equitySymbol?: number[] | Uint8Array;
  strikePriceE6?: { toNumber?: () => number } | number | bigint;
  expiryTs?: { toNumber?: () => number } | number | bigint;
  status?: number;
  yesMint?: PublicKey | string;
  noMint?: PublicKey | string;
  collateralVault?: PublicKey | string;
  /** Not on StrikeMarket — filled by indexer HTTP if known */
  treasury?: PublicKey | string;
  phoenixMarket?: PublicKey | string;
  pythPriceFeed?: PublicKey | string;
  settlementPriceE6?: { toNumber?: () => number } | number | bigint;
  settledAtTs?: { toNumber?: () => number } | number | bigint;
}

function bnToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

const DEFAULT_TICK = 0.01;
const DEFAULT_LOT = 1;

/** Phoenix default pubkey (unset) often all-zeros or system program — treat as missing. */
function phoenixOrUndefined(pk: string | undefined): string | undefined {
  if (!pk) return undefined;
  if (pk === PublicKey.default.toBase58()) return undefined;
  if (/^1+$/.test(pk) || pk.startsWith("11111111")) return undefined;
  return pk;
}

export function mapStrikeMarketToView(
  pubkey: string,
  acc: RawStrikeMarket,
): MarketView {
  const symbol = acc.equitySymbol
    ? decodeSymbol(acc.equitySymbol)
    : "????";
  const strikeE6 = bnToNumber(acc.strikePriceE6);
  const strike = strikeE6 / 1e6;
  const expiry = bnToNumber(acc.expiryTs);
  const status = settleStatusLabel(acc.status ?? 0);
  const midUnset = status === "open" ? undefined : status === "settled-yes" ? 1 : status === "settled-no" ? 0 : undefined;

  const question = `Will ${symbol} close at or above $${strike.toFixed(2)}?`;

  const settledPrice = bnToNumber(acc.settlementPriceE6);
  const phoenix = phoenixOrUndefined(
    acc.phoenixMarket ? pkStr(acc.phoenixMarket) : undefined,
  );

  return {
    marketId: pubkey,
    question,
    underlyingSymbol: symbol || "????",
    strike,
    comparator: ">=",
    tradingCloseTs: expiry,
    settleTs: expiry,
    status,
    outcome:
      status === "settled-yes"
        ? "yes"
        : status === "settled-no"
          ? "no"
          : status === "void"
            ? "void"
            : undefined,
    resolvedPrice: settledPrice > 0 ? settledPrice / 1e6 : undefined,
    resolvedAt: bnToNumber(acc.settledAtTs) || undefined,
    pythFeedId: acc.pythPriceFeed ? pkStr(acc.pythPriceFeed) : undefined,
    phoenixMarket: phoenix,
    yesMint: acc.yesMint ? pkStr(acc.yesMint) : undefined,
    noMint: acc.noMint ? pkStr(acc.noMint) : undefined,
    collateralVault: acc.collateralVault ? pkStr(acc.collateralVault) : undefined,
    treasury: acc.treasury ? pkStr(acc.treasury) : undefined,
    yesMid: midUnset,
    tickSize: DEFAULT_TICK,
    lotSize: DEFAULT_LOT,
    minPrice: 0.01,
    maxPrice: 0.99,
  };
}
