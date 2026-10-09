/**
 * Settlement countdown states — docs/ui/06 §3
 * Uses chain-skewed "now" from ChainClock when available.
 */
import type { MarketLifecycleStatus } from "@/lib/intents/types";
import type { MarketView } from "./types";

/** OPEN: PM — grace after settleTs before Delayed (default 30m) */
export const RESOLUTION_GRACE_SECS = 30 * 60;

/** UI disables trading slightly early vs program (OPEN: buffer) */
export const CLOSE_BUFFER_SECS = 5;

export interface CountdownView {
  state: MarketLifecycleStatus;
  /** Primary relative label e.g. "Closes in 2d 4h 12m" */
  relativeLabel: string;
  /** Absolute e.g. "Oct 16, 3:00 PM CT" */
  absoluteLabel: string;
  tradingEnabled: boolean;
  colorToken: "neutral" | "amber" | "neutral-muted" | "green" | "red";
}

function formatDuration(secs: number): string {
  if (secs < 0) secs = 0;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function formatAbsolute(ts: number, timeZone = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ts * 1000));
}

export function mapSchemaStatus(
  status: MarketView["status"],
): Pick<MarketView, "outcome"> & { settled: boolean } {
  if (status === "settled-yes") return { settled: true, outcome: "yes" };
  if (status === "settled-no") return { settled: true, outcome: "no" };
  if (status === "void") return { settled: true, outcome: "void" };
  return { settled: false };
}

export function getCountdown(
  market: MarketView,
  nowSec: number,
  timeZone = "America/Chicago",
): CountdownView {
  const closeTs = market.tradingCloseTs - CLOSE_BUFFER_SECS;
  const settleTs = market.settleTs;
  const absClose = formatAbsolute(market.tradingCloseTs, timeZone);
  const mapped = mapSchemaStatus(market.status);

  if (mapped.settled && market.status === "void") {
    return {
      state: "voided",
      relativeLabel: "Market voided — collateral returned at 0.50/contract",
      absoluteLabel: absClose,
      tradingEnabled: false,
      colorToken: "neutral",
    };
  }

  if (mapped.settled) {
    const side = mapped.outcome === "yes" ? "Yes" : "No";
    const price =
      market.resolvedPrice != null
        ? ` · ${market.underlyingSymbol} closed $${market.resolvedPrice.toFixed(2)} ${market.resolvedPrice >= market.strike ? "≥" : "<"} $${market.strike.toFixed(2)}`
        : "";
    return {
      state: "settled",
      relativeLabel: `Settled: ${side}${price}`,
      absoluteLabel: market.resolvedAt
        ? formatAbsolute(market.resolvedAt, timeZone)
        : absClose,
      tradingEnabled: false,
      colorToken: mapped.outcome === "yes" ? "green" : "red", // D-028: outcome colour (green Yes, red No)
    };
  }

  if (market.status === "settling" || nowSec >= settleTs) {
    if (nowSec > settleTs + RESOLUTION_GRACE_SECS) {
      return {
        state: "delayed",
        relativeLabel:
          "Resolution delayed. Funds are safe; result will post when the oracle updates.",
        absoluteLabel: formatAbsolute(settleTs, timeZone),
        tradingEnabled: false,
        colorToken: "amber",
      };
    }
    if (nowSec >= settleTs) {
      return {
        state: "resolving",
        relativeLabel: "Resolving with Pyth…",
        absoluteLabel: formatAbsolute(settleTs, timeZone),
        tradingEnabled: false,
        colorToken: "neutral-muted",
      };
    }
  }

  if (nowSec >= closeTs) {
    return {
      state: "closed",
      relativeLabel: `Trading closed · Result expected ~${formatAbsolute(settleTs, timeZone)}`,
      absoluteLabel: absClose,
      tradingEnabled: false,
      colorToken: "neutral-muted",
    };
  }

  const remaining = market.tradingCloseTs - nowSec;
  const closingSoon = remaining <= 3600;

  if (closingSoon) {
    return {
      state: "closing-soon",
      relativeLabel: `Closes in ${formatDuration(remaining)}`,
      absoluteLabel: absClose,
      tradingEnabled: true,
      colorToken: "amber",
    };
  }

  return {
    state: "open",
    relativeLabel: `Closes in ${formatDuration(remaining)}`,
    absoluteLabel: absClose,
    tradingEnabled: true,
    colorToken: "neutral",
  };
}
