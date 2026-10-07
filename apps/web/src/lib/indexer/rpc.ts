/**
 * RPC / getProgramAccounts indexer over Meridian StrikeMarket.
 * Uses prod IDL only (no localnet fixtures).
 */
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MERIDIAN_IDL } from "@/lib/solana/idl";
import { getProgramId, getRpcUrl } from "@/lib/solana/config";
import { mapStrikeMarketToView, type RawStrikeMarket } from "./mapStrikeMarket";
import type { MarketView } from "@/lib/market/types";

/** Read-only wallet stub for Anchor Program fetches (SSR / no signer). */
function readOnlyProvider(connection: Connection): AnchorProvider {
  const kp = Keypair.generate();
  const wallet = {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
  return new AnchorProvider(connection, wallet as AnchorProvider["wallet"], {
    commitment: "confirmed",
  });
}

function getReadProgram(connection: Connection): Program {
  const programId = getProgramId();
  const idl = { ...MERIDIAN_IDL, address: programId.toBase58() };
  return new Program(idl as typeof MERIDIAN_IDL, readOnlyProvider(connection));
}

export async function fetchMarketsViaRpc(
  rpcUrl = getRpcUrl(),
): Promise<MarketView[]> {
  const connection = new Connection(rpcUrl, "confirmed");
  const program = getReadProgram(connection);
  const all = await (program.account as { strikeMarket: { all: () => Promise<{ publicKey: PublicKey; account: RawStrikeMarket }[]> } }).strikeMarket.all();
  return all.map(({ publicKey, account }) =>
    mapStrikeMarketToView(publicKey.toBase58(), account),
  );
}

export async function fetchMarketViaRpc(
  marketId: string,
  rpcUrl = getRpcUrl(),
): Promise<MarketView | null> {
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const program = getReadProgram(connection);
    const pk = new PublicKey(marketId);
    const acc = await (program.account as { strikeMarket: { fetch: (k: PublicKey) => Promise<RawStrikeMarket> } }).strikeMarket.fetch(pk);
    return mapStrikeMarketToView(pk.toBase58(), acc);
  } catch {
    // marketId might be numeric fixture id — RPC only accepts pubkeys
    return null;
  }
}
