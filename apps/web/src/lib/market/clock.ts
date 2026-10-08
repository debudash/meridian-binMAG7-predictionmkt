/**
 * Hydration-stable clock (DLV-086).
 *
 * The server renders time-derived text ("Closes in 6d 16h 5m", "41:58") with
 * its own `Date.now()`. If the client's first (hydration) render uses a
 * different `Date.now()` — a minute/second boundary passed while the page
 * loaded, or the user's clock is skewed — React throws #425/#418 and
 * client-renders the whole Suspense boundary.
 *
 * Fix: the root layout passes the server's render time down; until the
 * provider has mounted, every consumer of `useChainClock()` sees exactly that
 * time, so server HTML and the hydration render match. After mount the clock
 * switches to the live local clock and ticks every second.
 */
export function resolveClockNowSec(args: {
  mounted: boolean;
  serverNowSec?: number;
  clientNowMs: number;
  skewMs: number;
}): number {
  const { mounted, serverNowSec, clientNowMs, skewMs } = args;
  if (!mounted && typeof serverNowSec === "number" && Number.isFinite(serverNowSec)) {
    return Math.floor(serverNowSec);
  }
  return Math.floor((clientNowMs + skewMs) / 1000);
}
