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
import { decodePythPriceAccount } from "@/lib/pyth/priceAccount";
import { isMissingAccountError, logChainReadError } from "@/lib/log/chainRead";
import { attachPhoenixQuotes } from "./phoenixQuotes";

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
  } catch (e) {
    // Mint / merge need the treasury; without it trades fail later — make the cause visible.
    logChainReadError("rpc.config.treasury", e);
    return undefined;
  }
}

/**
 * Underlying price from each market's `pyth_price_feed` account (mock Pyth on localnet,
 * Pyth on devnet/mainnet) — one batched getMultipleAccountsInfo (≤100 per call).
 * Undecodable / missing accounts leave `underlyingPrice` unset (UI shows "—").
 */
export async function attachUnderlyingPrices(
  connection: Connection,
  views: MarketView[],
): Promise<void> {
  const withFeed: { v: MarketView; key: PublicKey }[] = [];
  for (const v of views) {
    if (!v.pythFeedId) continue;
    try {
      withFeed.push({ v, key: new PublicKey(v.pythFeedId) });
    } catch {
      // not a pubkey (fixture) — skip
    }
  }
  for (let i = 0; i < withFeed.length; i += 100) {
    const chunk = withFeed.slice(i, i + 100);
    try {
      const infos = await connection.getMultipleAccountsInfo(
        chunk.map((c) => c.key),
        "confirmed",
      );
      infos.forEach((info, j) => {
        const d = decodePythPriceAccount(info?.data);
        if (d) {
          chunk[j].v.underlyingPrice = d.price;
          if (d.publishTime) chunk[j].v.underlyingPublishTs = d.publishTime;
        }
      });
    } catch (e) {
      // price stays unset
      logChainReadError("rpc.pyth.prices", e, { count: chunk.length });
    }
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
  await Promise.all([
    attachPhoenixQuotes(connection, views),
    attachUnderlyingPrices(connection, views),
  ]);
  return views;
}

export async function fetchMarketViaRpc(
  marketId: string,
  rpcUrl = getRpcUrl(),
): Promise<MarketView | null> {
  let pk: PublicKey;
  try {
    pk = new PublicKey(marketId);
  } catch {
    return null; // fixture slug / not a pubkey — RPC only knows pubkeys
  }
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const program = getReadProgram(connection);
    const acc = await (program.account as { strikeMarket: { fetch: (k: PublicKey) => Promise<RawStrikeMarket> } }).strikeMarket.fetch(pk);
    const treasury = await fetchTreasury(program);
    const view = mapStrikeMarketToView(pk.toBase58(), { ...acc, treasury: acc.treasury ?? treasury });
    await Promise.all([
      attachPhoenixQuotes(connection, [view]),
      attachUnderlyingPrices(connection, [view]),
    ]);
    return view;
  } catch (e) {
    if (isMissingAccountError(e)) return null; // genuine 404
    logChainReadError("rpc.getMarket", e, { marketId });
    throw e;
  }
}
