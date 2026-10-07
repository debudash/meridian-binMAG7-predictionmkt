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

/** Config.treasury is not on StrikeMarket; mint/merge need it (address = config.treasury). */
async function fetchTreasury(program: Program): Promise<string | undefined> {
  try {
    const [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );
    const acc = await (program.account as { config: { fetch: (k: PublicKey) => Promise<{ treasury: PublicKey }> } }).config.fetch(config);
    return acc.treasury.toBase58();
  } catch {
    return undefined;
  }
}

/**
 * Top-of-book from Phoenix for markets with phoenixMarket set (one batched RPC).
 * createWithoutConfig avoids the SDK's remote master_config (absent on localnet).
 */
async function attachPhoenixQuotes(
  connection: Connection,
  views: MarketView[],
): Promise<void> {
  const withBook = views.filter((v) => v.phoenixMarket);
  if (withBook.length === 0) return;
  try {
    const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
    const client = await PhoenixSdk.Client.createWithoutConfig(
      connection,
      withBook.map((v) => new PublicKey(v.phoenixMarket!)),
      false,
    );
    for (const v of withBook) {
      try {
        const ladder = client.getUiLadder(v.phoenixMarket!, 1);
        const bid = ladder.bids?.[0]?.price;
        const ask = ladder.asks?.[0]?.price;
        if (bid != null) v.yesBid = bid;
        if (ask != null) v.yesAsk = ask;
        if (bid != null && ask != null) v.yesMid = Math.round(((bid + ask) / 2) * 1000) / 1000;
        else if (bid != null || ask != null) v.yesMid = (bid ?? ask) as number;
      } catch {
        // leave quotes unset for this market
      }
    }
  } catch {
    // Phoenix unavailable on this cluster — quotes stay "—"
  }
}

export async function fetchMarketsViaRpc(
  rpcUrl = getRpcUrl(),
): Promise<MarketView[]> {
  const connection = new Connection(rpcUrl, "confirmed");
  const program = getReadProgram(connection);
  const all = await (program.account as { strikeMarket: { all: () => Promise<{ publicKey: PublicKey; account: RawStrikeMarket }[]> } }).strikeMarket.all();
  const treasury = await fetchTreasury(program);
  const views = all.map(({ publicKey, account }) =>
    mapStrikeMarketToView(publicKey.toBase58(), { ...account, treasury: account.treasury ?? treasury }),
  );
  await attachPhoenixQuotes(connection, views);
  return views;
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
    const treasury = await fetchTreasury(program);
    const view = mapStrikeMarketToView(pk.toBase58(), { ...acc, treasury: acc.treasury ?? treasury });
    await attachPhoenixQuotes(connection, [view]);
    return view;
  } catch {
    // marketId might be numeric fixture id — RPC only accepts pubkeys
    return null;
  }
}
