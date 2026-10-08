/**
 * Prod/devnet permissionless settle via the Pyth pull oracle (D-025 / DLV-078).
 *
 * 1. If the market's registered sponsored feed account (receiver-owned PriceUpdateV2) already
 *    holds the first price at/after expiry, settle against it (no Hermes call).
 * 2. Otherwise fetch that price from Hermes (`/v2/updates/price/{expiry}`, API key required),
 *    check the D-025 rule client-side, post it fully verified through the Pyth Solana Receiver
 *    and call `settle` with the freshly posted PriceUpdateV2 in the same builder batch
 *    (update accounts closed afterwards to recover rent).
 * Never throws for "expected" misses — returns { ok: false, reason } so the caller can retry /
 * fall back to admin_settle.
 */
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { configPda } from "./pdas";
import { checkSettlePrice, decodePriceUpdateV2, publishWindowSecs, PYTH_RECEIVER_PROGRAM_ID } from "../pyth/pullOracle";
import { fetchUpdateAt, HermesApiKeyError, HermesUpdate } from "../pyth/hermes";

export interface PullSettleMarket {
  market: PublicKey;
  expiryTs: number;
  feedIdHex: string;
  sponsoredFeed: PublicKey | null;
}

export interface PullSettleDeps {
  getAccountInfo(pk: PublicKey): Promise<{ owner: PublicKey; data: Buffer } | null>;
  fetchUpdate(feedIdHex: string, publishTime: number): Promise<HermesUpdate>;
  /** Plain settle against an existing PriceUpdateV2 account. */
  settleWithAccount(priceUpdate: PublicKey): Promise<string>;
  /** Post `vaas` via the receiver, then settle with the posted account; returns signatures. */
  postAndSettle(vaas: string[], feedIdHex: string): Promise<string[]>;
}

export type PullSettleResult =
  | { ok: true; via: "sponsored" | "posted"; signatures: string[] }
  | { ok: false; reason: string; needsApiKey?: boolean };

export async function settleWithPullOracle(
  m: PullSettleMarket,
  rule: { windowSecs: number; maxConfBps: number },
  deps: PullSettleDeps
): Promise<PullSettleResult> {
  const ruleOpts = { expiryTs: m.expiryTs, feedIdHex: m.feedIdHex, ...rule };

  if (m.sponsoredFeed) {
    try {
      const info = await deps.getAccountInfo(m.sponsoredFeed);
      if (info && info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
        const u = decodePriceUpdateV2(info.data);
        if (u.fullyVerified && checkSettlePrice(u, ruleOpts).ok) {
          const sig = await deps.settleWithAccount(m.sponsoredFeed);
          return { ok: true, via: "sponsored", signatures: [sig] };
        }
      }
    } catch {
      /* fall through to Hermes */
    }
  }

  let upd: HermesUpdate;
  try {
    upd = await deps.fetchUpdate(m.feedIdHex, m.expiryTs);
  } catch (e) {
    return { ok: false, reason: String((e as Error).message ?? e), needsApiKey: e instanceof HermesApiKeyError };
  }
  const r = checkSettlePrice(upd.parsed, ruleOpts);
  if (!r.ok) return { ok: false, reason: `${r.code}: ${r.reason}` };
  const sigs = await deps.postAndSettle(upd.vaas, m.feedIdHex);
  return { ok: true, via: "posted", signatures: sigs };
}

/** Real dependencies: Hermes + @pythnetwork/pyth-solana-receiver + Meridian `settle`. */
export function livePullSettleDeps(opts: {
  program: Program;
  connection: Connection;
  settler: Keypair;
  market: PublicKey;
  hermesUrl: string;
  hermesApiKey: string | undefined;
  computeUnitPriceMicroLamports?: number;
}): PullSettleDeps {
  const [config] = configPda(opts.program.programId);
  const settleIx = (priceUpdate: PublicKey): Promise<TransactionInstruction> =>
    (opts.program.methods as any)
      .settle()
      .accountsPartial({
        settler: opts.settler.publicKey,
        config,
        strikeMarket: opts.market,
        pythPriceFeed: priceUpdate,
        simClock: null,
      })
      .instruction();
  return {
    getAccountInfo: async (pk) => {
      const i = await opts.connection.getAccountInfo(pk, "confirmed");
      return i ? { owner: i.owner, data: Buffer.from(i.data) } : null;
    },
    fetchUpdate: (feedIdHex, t) =>
      fetchUpdateAt({ baseUrl: opts.hermesUrl, apiKey: opts.hermesApiKey, feedIdHex, publishTime: t }),
    settleWithAccount: async (pk) =>
      (opts.program.methods as any)
        .settle()
        .accountsPartial({ settler: opts.settler.publicKey, config, strikeMarket: opts.market, pythPriceFeed: pk, simClock: null })
        .signers([opts.settler])
        .rpc(),
    postAndSettle: async (vaas, feedIdHex) => {
      // Lazy import keeps localnet/sim paths free of the receiver SDK.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PythSolanaReceiver } = require("@pythnetwork/pyth-solana-receiver");
      const wallet = new Wallet(opts.settler);
      const receiver = new PythSolanaReceiver({ connection: opts.connection, wallet });
      const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
      await builder.addPostPriceUpdates(vaas);
      await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount: (id: string) => PublicKey) => [
        { instruction: await settleIx(getPriceUpdateAccount(`0x${feedIdHex.replace(/^0x/, "")}`)), signers: [] },
      ]);
      const txs = await builder.buildVersionedTransactions({
        computeUnitPriceMicroLamports: opts.computeUnitPriceMicroLamports ?? 50_000,
        tightComputeBudget: true,
      });
      const provider = new AnchorProvider(opts.connection, wallet, { commitment: "confirmed" });
      return provider.sendAll(txs, { skipPreflight: false });
    },
  };
}

export { publishWindowSecs };
