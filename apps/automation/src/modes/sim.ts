/**
 * LOCALNET-ONLY sim lifecycle helpers (D-017).
 *
 * This module must ONLY be imported by the sim entrypoint (`sim-lifecycle.ts`).
 * Never import from `worker.ts` / calendar path — keeps Railway prod bundle free of
 * upsert_mock_pyth / sim_* / test_drain_vault call sites.
 *
 * Uses localnet IDL instructions: sim_open_session, sim_close_session, upsert_mock_pyth
 * (as landed on main via eng/sim-session — trading_open + session ixs under localnet-test).
 */
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AutomationConfig } from "../config";
import { buildStrikes } from "../strikes";
import { configPda, deriveStrikeMarket, marketPdas } from "../solana/pdas";
import {
  adminSettleMarket,
  createStrikeMarket,
  setPhoenixMarket,
  settleMarket,
} from "../solana/instructions";

export const SIM_MODULE_MARKER = "meridian-automation-sim-localnet-only";

function log(msg: string, extra?: unknown) {
  const line = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`;
  console.log(`[sim] ${line}`);
}

export async function upsertMockPyth(opts: {
  program: Program;
  payer: Keypair;
  pythFeed: Keypair;
  price: bigint;
  conf?: bigint;
  expo?: number;
  publishSlot?: bigint;
  feedId?: Buffer;
}): Promise<string> {
  const methods = opts.program.methods as any;
  if (typeof methods.upsertMockPyth !== "function") {
    throw new Error(
      "upsertMockPyth missing — load localnet IDL (idl/meridian.json) on SOLANA_CLUSTER=localnet"
    );
  }
  return await methods
    .upsertMockPyth({
      price: new BN(opts.price.toString()),
      conf: new BN((opts.conf ?? 1000n).toString()),
      expo: opts.expo ?? -8,
      publishSlot: new BN((opts.publishSlot ?? 0n).toString()),
      feedId: Array.from(opts.feedId ?? Buffer.alloc(32, 0)),
    })
    .accounts({
      payer: opts.payer.publicKey,
      pythPriceFeed: opts.pythFeed.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([opts.payer, opts.pythFeed])
    .rpc();
}

async function callSimIx(
  program: Program,
  authority: Keypair,
  market: PublicKey,
  kind: "open" | "close"
): Promise<string> {
  const methods = program.methods as any;
  const names =
    kind === "open"
      ? ["simOpenSession", "simOpen", "sim_open_session"]
      : ["simCloseSession", "simClose", "sim_close_session"];
  let fn: ((...a: any[]) => any) | null = null;
  for (const n of names) {
    if (typeof methods[n] === "function") {
      fn = methods[n].bind(methods);
      break;
    }
  }
  if (!fn) {
    throw new Error(
      `${kind} sim ix missing on IDL — expected sim_open_session / sim_close_session (localnet-test)`
    );
  }
  const [config] = configPda(program.programId);
  return await fn()
    .accounts({
      authority: authority.publicKey,
      config,
      strikeMarket: market,
    })
    .signers([authority])
    .rpc();
}

export async function simOpenSession(
  program: Program,
  authority: Keypair,
  market: PublicKey
): Promise<string> {
  return callSimIx(program, authority, market, "open");
}

export async function simCloseSession(
  program: Program,
  authority: Keypair,
  market: PublicKey
): Promise<string> {
  return callSimIx(program, authority, market, "close");
}

/**
 * One-command scripted lifecycle:
 * create → sim_open → (mint path documented) → sim_close → settle / admin_settle.
 *
 * Does not weaken prod invariants: only callable when cluster=localnet + MODE=sim.
 */
export async function runSimLifecycle(opts: {
  cfg: AutomationConfig;
  program: Program;
  authority: Keypair;
  /** M3: settle signer + fee payer (own Program/provider); omitted → authority (localnet only). */
  settler?: { keypair: Keypair; program: Program };
}): Promise<void> {
  if (opts.cfg.cluster !== "localnet") {
    throw new Error("runSimLifecycle refused: cluster must be localnet");
  }
  if (opts.cfg.mode !== "sim") {
    throw new Error("runSimLifecycle refused: MODE must be sim");
  }
  if (!opts.cfg.collateralMint) {
    throw new Error("COLLATERAL_MINT required");
  }

  const pythFeed = Keypair.generate();
  const feedId = opts.cfg.pythFeedIds[opts.cfg.symbols[0]] ?? Buffer.alloc(32, 1);
  // Price $180.00 with expo -8 → 180_000_000 e6
  await upsertMockPyth({
    program: opts.program,
    payer: opts.authority,
    pythFeed,
    price: 18_000_000_000n,
    conf: 1_000n,
    expo: -8,
    publishSlot: 1n,
    feedId,
  });
  log("upsert_mock_pyth", { feed: pythFeed.publicKey.toBase58() });

  const expiryTs = Math.floor(Date.now() / 1000) + 3600;
  const strikes = buildStrikes({
    symbols: opts.cfg.symbols.slice(0, 1),
    priorCloseE6: opts.cfg.priorCloseE6,
    offsetsE6: [0],
    expiryTs,
    feedIds: { [opts.cfg.symbols[0]]: feedId },
    phoenixMarkets: opts.cfg.phoenixMarkets,
  });
  const strike = strikes[0];

  const { market, signature } = await createStrikeMarket({
    program: opts.program,
    authority: opts.authority,
    collateralMint: opts.cfg.collateralMint,
    pythPriceFeed: pythFeed.publicKey,
    strike,
  });
  log("create_strike_market", { market: market.toBase58(), sig: signature });

  const phoenix = opts.cfg.phoenixMarkets[strike.symbol];
  if (phoenix && !phoenix.equals(PublicKey.default)) {
    await setPhoenixMarket({
      program: opts.program,
      authority: opts.authority,
      market,
      phoenixMarket: phoenix,
    });
    log("set_phoenix_market", { phoenix: phoenix.toBase58() });
  }

  const openSig = await simOpenSession(opts.program, opts.authority, market);
  log("sim_open_session", { sig: openSig });

  log(
    "mint + on-book trade (manual / harness): meridian mint(amount) while trading_open; " +
      "prefer simTradeOnBook (Buy/Sell Yes/No book-sim + Sell No merge_pair) — docs/TEST_MATRIX.md (PHX cases); " +
      "off-book Yes SPL demoted. Phoenix market create still residual (D-015). PDAs: " +
      JSON.stringify(
        Object.fromEntries(
          Object.entries(marketPdas(opts.program.programId, market)).map(([k, v]) => [
            k,
            (v as PublicKey).toBase58(),
          ])
        )
      )
  );
  void deriveStrikeMarket;

  const closeSig = await simCloseSession(opts.program, opts.authority, market);
  log("sim_close_session", { sig: closeSig });

  // Settle may require expiry via wall clock or session close semantics on-chain.
  try {
    const settler = opts.settler ?? { keypair: opts.authority, program: opts.program };
    const sig = await settleMarket({
      program: settler.program,
      settler: settler.keypair,
      market,
      pythPriceFeed: pythFeed.publicKey,
    });
    log("settle", { sig });
  } catch (e) {
    log(`settle failed (will try admin_settle if configured): ${e}`);
    if (opts.cfg.adminSettlePriceE6 !== null && opts.cfg.adminSettleOutcomeYes !== null) {
      const sig = await adminSettleMarket({
        program: opts.program,
        authority: opts.authority,
        market,
        settlementPriceE6: new BN(opts.cfg.adminSettlePriceE6.toString()),
        outcomeYes: opts.cfg.adminSettleOutcomeYes,
      });
      log("admin_settle", { sig });
    } else {
      log(
        "Set ADMIN_SETTLE_PRICE_E6 + ADMIN_SETTLE_OUTCOME_YES to force admin path after delay, " +
          "or wait for wall expiry / warp if SimClock lands."
      );
    }
  }

  log("sim lifecycle complete", { market: market.toBase58() });
}
