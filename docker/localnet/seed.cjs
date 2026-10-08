#!/usr/bin/env node
/**
 * Seed the Docker localnet (docker/localnet/start.sh step 5). LOCALNET ONLY, idempotent:
 *   - authority / maker / dev wallet get faucet SOL;
 *   - first run: fixture USDC mint (6 decimals, authority = mint authority), treasury ATA, initialize_config
 *     (fees 0, staleness 150 slots, conf 500 bps, admin_settle delay ADMIN_SETTLE_DELAY_SECS default 0);
 *   - dev wallet gets 100,000 fixture USDC (once);
 *   - markets: scripts/localnet/today-markets.cjs. During a trading day before 16:00 ET that's today's-close 0DTE
 *     markets; otherwise (after the close, weekend, holiday) the D-017 anytime variant with expiry = now +
 *     ANYTIME_EXPIRY_MINUTES (default 120). SEED_MODE=today|anytime forces one.
 * Writes /data/state/local.json (addresses only, no secrets) for the web env and settle.cjs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = "/repo";
const W = path.join(REPO, "apps/web/node_modules") + "/";
const web3 = require(W + "@solana/web3.js");
const spl = require(W + "@solana/spl-token");
const anchor = require(W + "@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = web3;

const RPC = "http://127.0.0.1:8899";
const KEYS = "/data/keys";
const STATE = "/data/state/local.json";
const TODAY_STATE = "/data/state/today-markets.json";
const PROGRAM_ID = new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");
const kp = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${KEYS}/${n}.json`, "utf8"))));

async function airdropTo(conn, pk, sol) {
  if ((await conn.getBalance(pk)) >= sol * LAMPORTS_PER_SOL / 2) return;
  await conn.confirmTransaction(await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL), "confirmed");
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const authority = kp("authority"), maker = kp("maker"), dev = kp("devwallet");
  await airdropTo(conn, authority.publicKey, 1000);
  await airdropTo(conn, maker.publicKey, 50);
  await airdropTo(conn, dev.publicKey, 20);

  const idl = JSON.parse(fs.readFileSync(path.join(REPO, "target/idl/meridian.json"), "utf8"));
  const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(authority), { commitment: "confirmed" }));
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

  let usdc, treasury;
  if (!(await conn.getAccountInfo(configPda))) {
    console.log("[seed] first run: fixture USDC + initialize_config");
    const mintKp = Keypair.generate();
    usdc = mintKp.publicKey;
    const lamports = await conn.getMinimumBalanceForRentExemption(spl.MINT_SIZE);
    treasury = spl.getAssociatedTokenAddressSync(usdc, authority.publicKey);
    await web3.sendAndConfirmTransaction(conn, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: authority.publicKey, newAccountPubkey: usdc, space: spl.MINT_SIZE, lamports, programId: spl.TOKEN_PROGRAM_ID }),
      spl.createInitializeMint2Instruction(usdc, 6, authority.publicKey, null),
      spl.createAssociatedTokenAccountInstruction(authority.publicKey, treasury, authority.publicKey, usdc),
    ), [authority, mintKp], { commitment: "confirmed" });
    await program.methods.initializeConfig({
      mintFeeBps: 0, redeemFeeBps: 0, settleMaxStalenessSlots: new anchor.BN(150), settleMaxConfRatioBps: 500,
      adminSettleDelaySecs: new anchor.BN(Number(process.env.ADMIN_SETTLE_DELAY_SECS ?? 0)),
    }).accounts({ authority: authority.publicKey, config: configPda, collateralMint: usdc, treasury, systemProgram: SystemProgram.programId }).rpc();
  } else {
    const cfg = await program.account.config.fetch(configPda);
    usdc = cfg.collateralMint; treasury = cfg.treasury;
    console.log("[seed] config exists — reusing");
  }

  const devUsdc = spl.getAssociatedTokenAddressSync(usdc, dev.publicKey);
  if (!(await conn.getAccountInfo(devUsdc))) {
    await web3.sendAndConfirmTransaction(conn, new Transaction().add(
      spl.createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, devUsdc, dev.publicKey, usdc),
      spl.createMintToInstruction(usdc, devUsdc, authority.publicKey, 100_000_000_000n),
    ), [authority], { commitment: "confirmed" });
    console.log("[seed] dev wallet funded: 20 SOL + 100,000 USDC");
  }

  const state = { rpc: RPC, programId: PROGRAM_ID.toBase58(), usdcMint: usdc.toBase58(), treasury: treasury.toBase58(),
    authority: authority.publicKey.toBase58(), maker: maker.publicKey.toBase58(), devWallet: dev.publicKey.toBase58(),
    phoenixProgram: "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY", marketsState: TODAY_STATE };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

  // Markets: same-day first; anytime when there's no session left today (or when forced).
  const mode = process.env.SEED_MODE || "auto";
  const run = (extra) => spawnSync("node", ["scripts/localnet/today-markets.cjs"], {
    cwd: REPO, stdio: "inherit",
    env: { ...process.env, RPC, AUTH: `${KEYS}/authority.json`, MAKER: `${KEYS}/maker.json`, MERIDIAN_IDL: path.join(REPO, "target/idl/meridian.json"),
      STATE_OUT: TODAY_STATE, ...extra },
  }).status;
  let status = mode === "anytime" ? 3 : run({});
  if (status === 3 && mode !== "today") {
    const mins = process.env.ANYTIME_EXPIRY_MINUTES || "120";
    console.log(`[seed] no same-day session left — creating D-017 anytime markets expiring in ${mins} min`);
    status = run({ ANYTIME_EXPIRY_MINUTES: mins });
  }
  if (status !== 0) throw new Error(`today-markets.cjs exited ${status}`);
  console.log(`[seed] done — ${STATE}`);
}

main().catch((e) => { console.error("[seed] FAILED:", e); process.exit(1); });
