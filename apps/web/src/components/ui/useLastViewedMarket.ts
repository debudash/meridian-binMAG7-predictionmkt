"use client";

import { useEffect, useState } from "react";
import { lastViewedMarket, rememberViewedMarket } from "@/lib/ui/selection";

/** Read the last-opened market id after mount (sessionStorage; SSR-safe). */
export function useLastViewedMarket(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(lastViewedMarket());
  }, []);
  return id;
}

/** Record `marketId` as last viewed when the trade page mounts. */
export function useRememberViewedMarket(marketId: string) {
  useEffect(() => {
    rememberViewedMarket(marketId);
  }, [marketId]);
}
