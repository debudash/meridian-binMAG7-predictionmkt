/**
 * Find the settle tx for a market via RPC (DLV-076): getSignaturesForAddress(market)
 * → getTransactions in small batches → first Settled/AdminSettled event for it.
 */
import type { Connection, ConfirmedSignatureInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import { decodePythPriceAccount } from "@/lib/pyth/priceAccount";
import { orderSettleCandidates, parseSettleEventFromLogs, type SettleEvent } from "./proof";

export interface SettleTxLookup {
  event: SettleEvent | null;
  signature: string | null;
  blockTime: number | null;
  feedExpo?: number;
  mockFeed?: boolean;
}

const PAGE = 200;
const MAX_PAGES = 5;
const BATCH = 10;

export async function fetchSettleTx(
  connection: Connection,
  market: Pick<MarketView, "marketId" | "settledSlot" | "pythFeedId">,
): Promise<SettleTxLookup> {
  const out: SettleTxLookup = { event: null, signature: null, blockTime: null };

  // Feed expo (conf scaling) + mock detection — current account state.
  if (market.pythFeedId) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(market.pythFeedId), "confirmed");
      const d = decodePythPriceAccount(info?.data);
      if (d) {
        out.feedExpo = d.expo;
        out.mockFeed = d.source === "mock";
      }
    } catch {
      // leave unknown
    }
  }

  const marketPk = new PublicKey(market.marketId);
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let sigs: ConfirmedSignatureInfo[];
    try {
      sigs = await connection.getSignaturesForAddress(marketPk, { limit: PAGE, before }, "confirmed");
    } catch {
      return out;
    }
    if (sigs.length === 0) break;
    const ordered = orderSettleCandidates(sigs, market.settledSlot);
    for (let i = 0; i < ordered.length; i += BATCH) {
      const chunk = ordered.slice(i, i + BATCH);
      let txs;
      try {
        txs = await connection.getTransactions(
          chunk.map((c) => c.signature),
          { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
        );
      } catch {
        continue;
      }
      for (let j = 0; j < txs.length; j++) {
        const ev = parseSettleEventFromLogs(txs[j]?.meta?.logMessages, market.marketId);
        if (ev) {
          out.event = ev;
          out.signature = chunk[j].signature;
          out.blockTime = txs[j]?.blockTime ?? chunk[j].blockTime ?? null;
          return out;
        }
      }
    }
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < PAGE) break;
  }
  return out;
}
