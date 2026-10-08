/**
 * Read the wallet's recent Meridian activity from RPC (DLV-088).
 * getSignaturesForAddress(owner) → getParsedTransactions (batches of 20) → classify.
 * RPC failures reject; the hook logs them (DLV-090) and keeps the last good list.
 */
import { PublicKey, type Connection } from "@solana/web3.js";
import type { MarketView } from "@/lib/market/types";
import { classifyTransaction, settlementRows, type HistoryIndex, type HistoryRow, type ParsedTxLike } from "./classify";

export const HISTORY_TX_LIMIT = 100;
const BATCH = 20;

export async function readWalletHistory(
  connection: Pick<Connection, "getSignaturesForAddress" | "getParsedTransactions">,
  owner: PublicKey,
  markets: readonly MarketView[],
  idx: HistoryIndex,
  limit = HISTORY_TX_LIMIT,
): Promise<{ rows: HistoryRow[]; scanned: number; truncated: boolean }> {
  const sigs = (await connection.getSignaturesForAddress(owner, { limit }, "confirmed")).filter((s) => !s.err);
  const rows: HistoryRow[] = [];
  for (let i = 0; i < sigs.length; i += BATCH) {
    const part = sigs.slice(i, i + BATCH);
    const txs = await connection.getParsedTransactions(
      part.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    );
    txs.forEach((tx, j) => {
      const row = classifyTransaction(part[j].signature, tx as unknown as ParsedTxLike | null, owner.toBase58(), idx);
      if (row) {
        if (!row.ts) row.ts = part[j].blockTime ?? 0;
        rows.push(row);
      }
    });
  }
  const traded = new Set(rows.map((r) => r.marketId));
  rows.push(...settlementRows(markets, traded));
  rows.sort((a, b) => b.ts - a.ts);
  return { rows, scanned: sigs.length, truncated: sigs.length >= limit };
}
