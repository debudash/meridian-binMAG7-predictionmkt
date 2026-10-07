"use client";

import {
  isProgramPaused,
  isWrongCluster,
  expectedClusterLabel,
} from "@/lib/solana/banners";

export function GlobalBanners() {
  const wrong = isWrongCluster();
  const paused = isProgramPaused();
  if (!wrong && !paused) return null;

  return (
    <>
      {wrong && (
        <div className="banner" role="alert">
          You&apos;re connected to the wrong cluster. Meridian runs on{" "}
          <strong>{expectedClusterLabel()}</strong>. Trading CTAs are disabled until you
          switch network.
        </div>
      )}
      {paused && (
        <div className="banner banner-danger" role="alert">
          Trading is paused. All trade CTAs are disabled; redeem may still be available per
          program rules.
        </div>
      )}
    </>
  );
}

/** True when global banners should block trade CTAs. */
export function useTradingBlockedByBanner(): boolean {
  return isWrongCluster() || isProgramPaused();
}
