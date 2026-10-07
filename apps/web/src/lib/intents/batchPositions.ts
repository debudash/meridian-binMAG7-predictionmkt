/**
 * Batched wallet positions for a list of markets (DLV-074).
 *
 * One `getMultipleParsedAccounts` round-trip per ≤100 accounts covers the Yes + No
 * ATAs of every listed market — no per-card RPC. Pure helpers here (tested);
 * the polling hook lives in hooks/useWalletPositions.ts.
 */
import type { PositionSnapshot } from "./types";

/** RPC limit for getMultipleAccounts. */
export const MAX_ACCOUNTS_PER_CALL = 100;

export interface PositionMarketRef {
  marketId: string;
  yesMint?: string;
  noMint?: string;
}

export interface PositionRequest {
  marketId: string;
  /** Index into the flat `keys` array, or -1 if this mint is unknown */
  yesIdx: number;
  noIdx: number;
}

export interface PositionPlan {
  /** Unique ATA addresses (base58), in fetch order */
  keys: string[];
  requests: PositionRequest[];
}

/**
 * Build the fetch plan. `ataFor(mint)` derives the owner's ATA (injected so this
 * stays pure/testable). Markets without both mints are skipped. Duplicate ATAs
 * (shared mints) are fetched once.
 */
export function planPositionReads(
  markets: readonly PositionMarketRef[],
  ataFor: (mint: string) => string,
): PositionPlan {
  const keys: string[] = [];
  const index = new Map<string, number>();
  const idxOf = (ata: string) => {
    let i = index.get(ata);
    if (i == null) {
      i = keys.length;
      keys.push(ata);
      index.set(ata, i);
    }
    return i;
  };
  const requests: PositionRequest[] = [];
  const seen = new Set<string>();
  for (const m of markets) {
    if (!m.yesMint || !m.noMint || seen.has(m.marketId)) continue;
    seen.add(m.marketId);
    requests.push({
      marketId: m.marketId,
      yesIdx: idxOf(ataFor(m.yesMint)),
      noIdx: idxOf(ataFor(m.noMint)),
    });
  }
  return { keys, requests };
}

export function chunk<T>(arr: readonly T[], size = MAX_ACCOUNTS_PER_CALL): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** uiAmount from a jsonParsed SPL token account (null/missing account → 0). */
export function parsedTokenUiAmount(info: unknown): number {
  const data = (info as { data?: unknown } | null | undefined)?.data as
    | { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } }
    | undefined;
  const v = data?.parsed?.info?.tokenAmount?.uiAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Map fetched account infos (same order as plan.keys) to per-market positions. */
export function positionsFromAccounts(
  plan: PositionPlan,
  infos: readonly unknown[],
): Map<string, PositionSnapshot> {
  const out = new Map<string, PositionSnapshot>();
  for (const r of plan.requests) {
    out.set(r.marketId, {
      yesQty: parsedTokenUiAmount(infos[r.yesIdx]),
      noQty: parsedTokenUiAmount(infos[r.noIdx]),
    });
  }
  return out;
}
