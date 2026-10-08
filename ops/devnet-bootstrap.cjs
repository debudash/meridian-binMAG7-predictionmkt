/**
 * Meridian DEVNET staging bootstrap (prod build, no fixtures). Idempotent / resumable via STATE file.
 *   RPC=<devnet rpc> node devnet-bootstrap.cjs
 * env (required): RPC, KEYS (keypair dir), STATE (json out), MERIDIAN_PROGRAM_ID, WEB_NODE_MODULES (apps/web/node_modules/
 *      with @solana/web3.js, spl-token, anchor, phoenix-sdk), MERIDIAN_IDL (prod IDL; not needed for DRY_RUN)
 * env (optional): NBOOKS (Phoenix books to create, default 3), SHORT_MIN (short-expiry minutes, default 20),
 *      DRYRUN_LABEL (free text tag written to state)
 *      DRY_RUN=1          print the plan (PDAs, books, wallet funding, short-market timing) and exit: no RPC, no transactions
 *      TODAY_PLAN         JSON from `ops-cli market-day --strikes`: today's 16:00 ET close + ATM strikes (DLV-118). Needed for the
 *                         20-min market (ATM strike, L-4 cap) and, when BOOTSTRAP_DAILY_MARKETS=1, the daily markets.
 *      BOOTSTRAP_DAILY_MARKETS  0 (default) = ONE CREATOR: the Railway automation worker creates the daily markets and
 *                         this bootstrap does not (wallets / mUSDC / settler / pauser / Config / 20-min market only).
 *                         1 = also create today's markets + books (only when the worker is NOT creating). Read from the
 *                         env, else from $STAGING_ENV_FILE / ./staging.env at run time (a running watcher honours it).
 *      ADMIN_SETTLE_DELAY_SECS  admin_settle delay set at initialize_config (default 300; 60..3600). Staging: 60 (DLV-123).
 *      SHORT_PHASE        all (default) | skip (today's markets + wallets only) | only (just the 20-min AAPL ATM market)
 *      SHORT_BOOK         1 (default) = give the 20-min AAPL ATM market a Phoenix book + maker ladder (STAGING_TEST_PLAN §1.7b)
 *      SHORT_SETUP_SECS   extra seconds added to the short expiry to cover book + ladder setup (default 180)
 *      WALLET_B_KEY       wallet B keypair (default $KEYS/wallet-b.json) or WALLET_B=<pubkey> (e.g. a Phantom address)
 *      SETTLER_KEY        low-balance permissionless-settle key (default $KEYS/settler.json; Reviewers M3 / !70)
 *      SETTLER_SOL (0.05) settler SOL target: devnet faucet airdrop first, payer transfer only as fallback unless
 *                         SETTLER_PAYER_FALLBACK=0. Never the config authority; never more than ~SETTLER_SOL.
 *      WALLET_B_SOL (0.5) / WALLET_B_USDC (1000)   wallet B funding; SOL via devnet faucet airdrop (AIRDROP_RPC,
 *                         default api.devnet.solana.com); payer transfer only as fallback unless WALLET_B_PAYER_FALLBACK=0
 *      PAUSER_KEY         dedicated Phoenix pauser (default $KEYS/pauser.json; review dd46769). Right after each book is
 *                         created + handed to the Seat Manager, the seat-manager authority moves payer → pauser (PSM
 *                         NameSuccessor + ClaimSeatManagerAuthority, one tx signed by both). Existing books still held
 *                         by the payer are handed off on every run (idempotent). Missing key → books stay on the payer
 *                         (WARNING: then nothing on Railway can pause them).
 *      PAUSER_SOL (0.02)  pauser SOL target for PSM ChangeMarketStatus fees: faucet airdrop first, payer transfer only as
 *                         fallback unless PAUSER_PAYER_FALLBACK=0
 * Keys (in $KEYS, chmod 600, never committed):
 *   upgrade-authority.json  payer for Phoenix market rent + funding transfers
 *   keeper.json             Meridian config authority == AUTOMATION_KEYPAIR (Railway secret)
 *   admin.json              mUSDC mint authority + treasury owner (box only)
 *   maker.json, trader.json, usdc-mint.json, wallet-b.json (counterparty test wallet, plan §1.5/§4)
 *   settler.json            low-balance permissionless settle signer/payer == SETTLER_KEYPAIR (Railway secret)
 *   pauser.json             Phoenix seat-manager authority after the handoff == PHOENIX_PAUSER_KEYPAIR (Railway secret);
 *                           can pause/resume books, evict seats (funds return to traders), change the fee recipient —
 *                           cannot move user funds. upgrade-authority.json NEVER goes to Railway.
 */
const fs = require("fs");
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} required (see header)`); return v; };
const W = need("WEB_NODE_MODULES").replace(/\/?$/, "/");
const web3 = require(W + "@solana/web3.js");
const spl = require(W + "@solana/spl-token");
const anchor = require(W + "@coral-xyz/anchor");
const phx = require(W + "@ellipsis-labs/phoenix-sdk");
const psm = require("./lib/psm.cjs")(web3);
const { writeFileAtomicSync } = require("./lib/atomic-write.cjs"); // N-1: the pause watcher reads $STATE concurrently
const { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, Connection, LAMPORTS_PER_SOL } = web3;

const RPC = need("RPC");
const KEYS = need("KEYS");
const STATE = need("STATE");
const IDL = process.env.MERIDIAN_IDL; // required for a real run (checked in main)
const NBOOKS = Number(process.env.NBOOKS ?? 3);
const SHORT_MIN = Number(process.env.SHORT_MIN ?? 20);
const DRY_RUN = process.env.DRY_RUN === "1";
const SHORT_PHASE = process.env.SHORT_PHASE || "all"; // all | skip | only
// DLV-123: admin_settle delay written at initialize_config. 300 s by default; staging uses 60 s (the program's production
// minimum, MIN_ADMIN_SETTLE_DELAY_SECS_PROD) so the operator-price fallback can settle by 16:05 ET (Peak6 PRD).
const ADMIN_SETTLE_DELAY_SECS = Number(process.env.ADMIN_SETTLE_DELAY_SECS ?? 300);
if (!Number.isInteger(ADMIN_SETTLE_DELAY_SECS) || ADMIN_SETTLE_DELAY_SECS < 60 || ADMIN_SETTLE_DELAY_SECS > 3600) throw new Error(`ADMIN_SETTLE_DELAY_SECS must be 60..3600 (got ${process.env.ADMIN_SETTLE_DELAY_SECS})`);
if (!["all", "skip", "only"].includes(SHORT_PHASE)) throw new Error(`bad SHORT_PHASE ${SHORT_PHASE}`);
const SHORT_BOOK = process.env.SHORT_BOOK !== "0";
const SHORT_SETUP_SECS = Number(process.env.SHORT_SETUP_SECS ?? 180);
const WALLET_B_KEY = process.env.WALLET_B_KEY || `${KEYS}/wallet-b.json`;
const WALLET_B_SOL = Number(process.env.WALLET_B_SOL ?? 0.5);
const WALLET_B_USDC = Number(process.env.WALLET_B_USDC ?? 1000);
const AIRDROP_RPC = process.env.AIRDROP_RPC || "https://api.devnet.solana.com";
const WALLET_B_PAYER_FALLBACK = process.env.WALLET_B_PAYER_FALLBACK !== "0";
const SETTLER_KEY = process.env.SETTLER_KEY || `${KEYS}/settler.json`;
const SETTLER_SOL = Number(process.env.SETTLER_SOL ?? 0.05);
const SETTLER_PAYER_FALLBACK = process.env.SETTLER_PAYER_FALLBACK !== "0";
const PAUSER_KEY = process.env.PAUSER_KEY || `${KEYS}/pauser.json`;
const PAUSER_SOL = Number(process.env.PAUSER_SOL ?? 0.02);
const PAUSER_PAYER_FALLBACK = process.env.PAUSER_PAYER_FALLBACK !== "0";
const PROGRAM_ID = new PublicKey(need("MERIDIAN_PROGRAM_ID"));
const PHX = new PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
const PSM = new PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1");
const MARKET_SPACE = 232544; // (512 bids, 512 asks, 1153 seats) — PSM requires seats = bids+asks+1+128
const LOG_AUTH = phx.getLogAuthority();

// D-019 registry (SCHEMA §3.1): shard-0 Price Feed PDAs (same on devnet) + Pyth Core feed ids — all seven MAG7 (SPEC §1)
const FEEDS = {
  AAPL: ["DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy", "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688"],
  MSFT: ["7VYuuJxz8w2rLA9tJG2KZ9T1fSMcjC7uECoYA6nDaqtK", "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1"],
  GOOGL: ["HShKFQqhYkUiXpVyyLmrAALXwWqHB7ikLmPbrwJzpRNh", "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6"],
  AMZN: ["GBkjjFxbaFY9TBHpAPypk5JBchpPPve2jskAcd9zuFNd", "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a"],
  NVDA: ["2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC", "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593"],
  META: ["GsKrMNoa1Mqjpif4SYk2WjdduWZP699hXRdP51yBM6K2", "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe"],
  TSLA: ["E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ", "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1"],
};
// SCHEMA §3.1.1: on devnet the sponsored shard-1 accounts are the fresh ones (shard-0 is stale). PYTH_REF_SHARD=1 uses them
// as each market's reference/display feed (the web's "needs +x%" readout). Settle never trusts the address (D-025).
const SHARD1 = { AAPL: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW", MSFT: "EKhrgXYwqsjgxF71Gxznui1zdoeqgxJzzPzfefEmm5un",
  GOOGL: "7aUtbtC3o3GVwRWvaDp5fxKjBq53QL3UrVmDzDgeNo8M", AMZN: "4eT5d4SJ7GjD8HMpMysSNoPV7RBVTBGzoSEkynmPLMPS",
  NVDA: "5VETJ8h3p4JrESYrzhjTDAWPEjDjfcnduqe9CjxgqBNd", META: "6NJCSCAWy1yB1jEGhPbsMTrT4WH13o8BGD5wgPbBtdY9", TSLA: "FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z" };
if (process.env.PYTH_REF_SHARD === "1") for (const k of Object.keys(FEEDS)) FEEDS[k][0] = SHARD1[k];
// DLV-118 (SPEC §1/§3.3): markets expire at TODAY's 16:00 ET close with strikes ATM on the previous trading day's close (D-026).
// TODAY_PLAN = JSON from `ops-cli market-day --strikes` (run-staging.sh writes it). No fixed next-close date, no AAPL ≥ 300.
const { bootstrapPlanFromToday, shortExpiryFor, sameDayDuplicates } = require("./lib/today-plan.cjs");
function envOrStagingEnv(k) {
  if (process.env[k] !== undefined) return process.env[k];
  try {
    const f = process.env.STAGING_ENV_FILE || require("path").join(__dirname, "staging.env");
    const m = fs.readFileSync(f, "utf8").match(new RegExp("^\\s*(?:export\\s+)?" + k + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  } catch { return undefined; }
}
const DAILY_MARKETS = envOrStagingEnv("BOOTSTRAP_DAILY_MARKETS") === "1";
const TODAY_PLAN = process.env.TODAY_PLAN;
function todayPlan(nowSec) {
  if (!TODAY_PLAN) throw new Error("TODAY_PLAN required (run-staging.sh: ops-cli market-day --strikes > $TODAY_PLAN)");
  return bootstrapPlanFromToday(JSON.parse(fs.readFileSync(TODAY_PLAN, "utf8")), { nbooks: NBOOKS, feeds: FEEDS, nowSec });
}

const kp = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${KEYS}/${n}.json`, "utf8"))));
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vault = (market, mint) => PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer(), mint.toBuffer()], PHX)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad8 = (s) => { const b = Buffer.alloc(8, 0x20); Buffer.from(s).copy(b); return Array.from(b); };
const conn = new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
const sigs = [];

async function send(ixs, signers, label, cu = 400_000) {
  if (DRY_RUN) throw new Error(`DRY_RUN: refusing to send "${label}"`); // belt and braces: dry run never signs/sends
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ...ixs);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
      const raw = tx.serialize();
      const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 });
      for (let i = 0; i < 90; i++) {
        const st = (await conn.getSignatureStatuses([sig])).value[0];
        if (st?.err) throw Object.assign(new Error(`${label} failed ${JSON.stringify(st.err)} sig ${sig}`), { fatal: true });
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
          console.log(`  ${label}: ${sig}`); sigs.push({ label, sig }); return sig;
        }
        if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) break;
        if (i % 5 === 4) await conn.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {});
        await sleep(1000);
      }
      console.log(`  ${label}: not confirmed (attempt ${attempt}), retrying`);
    } catch (e) {
      if (e.fatal || attempt === 4) throw e;
      console.log(`  ${label}: attempt ${attempt} error ${String(e.message || e).slice(0, 300)}`);
      await sleep(2000 * attempt);
    }
  }
  throw new Error(`${label}: gave up`);
}

function initMarketIx(market, base, quote, creator) {
  const data = Buffer.concat([Buffer.from([100]), u64(512), u64(512), u64(1153), u64(1_000_000), u64(10_000), u64(1),
    Buffer.from([0, 0]), creator.toBuffer(), Buffer.from([0])]);
  return new TransactionInstruction({ programId: PHX, data, keys: [
    { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: LOG_AUTH, isSigner: false, isWritable: false },
    { pubkey: market, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: base, isSigner: false, isWritable: false }, { pubkey: quote, isSigner: false, isWritable: false },
    { pubkey: vault(market, base), isSigner: false, isWritable: true }, { pubkey: vault(market, quote), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false } ] });
}
const authIx = (code, payload, market, authority, w) => new TransactionInstruction({ programId: PHX, data: Buffer.concat([Buffer.from([code]), payload]), keys: [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: LOG_AUTH, isSigner: false, isWritable: false },
  { pubkey: market, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: w } ] });
const psmClaimIx = (market, payer) => new TransactionInstruction({ programId: PSM, data: Buffer.from([0]), keys: [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: LOG_AUTH, isSigner: false, isWritable: false },
  { pubkey: market, isSigner: false, isWritable: true }, { pubkey: phx.getSeatManagerAddress(market), isSigner: false, isWritable: true },
  { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: phx.getSeatDepositCollectorAddress(market), isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } ] });

// Wallet B public key: WALLET_B (pubkey) wins, else the box keypair file. Never prints the secret.
function walletBPub() {
  if (process.env.WALLET_B) return new PublicKey(process.env.WALLET_B);
  if (!fs.existsSync(WALLET_B_KEY)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_B_KEY, "utf8")))).publicKey;
}
// Settler public key (M3): low-balance key for permissionless settle. Never prints the secret.
function settlerPub() {
  if (!fs.existsSync(SETTLER_KEY)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SETTLER_KEY, "utf8")))).publicKey;
}
// Pauser public key (review dd46769): Phoenix seat-manager authority after the handoff. Never prints the secret.
function pauserKp() {
  if (!fs.existsSync(PAUSER_KEY)) return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PAUSER_KEY, "utf8"))));
}
// Seat-manager authority handoff payer → pauser, right after the book is under the Seat Manager (idempotent).
async function handoffToPauser(marketPk, payer, pauser, rec) {
  const smInfo = await conn.getAccountInfo(psm.seatManager(marketPk), "confirmed");
  if (!smInfo) { console.log(`  handoff: no seat manager for ${marketPk.toBase58()} (book not under PSM) — skipped`); return; }
  const cur = psm.decodeSeatManagerAuthority(smInfo.data);
  if (cur.equals(pauser.publicKey)) { rec.seatManagerAuthority = pauser.publicKey.toBase58(); return; }
  if (!cur.equals(payer.publicKey)) { console.log(`  handoff: SM authority ${cur.toBase58()} is neither payer nor pauser — left alone`); rec.seatManagerAuthority = cur.toBase58(); return; }
  rec.handoffSig = await send([psm.nameSuccessorIx(marketPk, payer.publicKey, pauser.publicKey), psm.claimSeatManagerAuthorityIx(marketPk, pauser.publicKey)],
    [payer, pauser], `seat-manager authority → pauser ${pauser.publicKey.toBase58()} (PSM NameSuccessor + ClaimSeatManagerAuthority)`);
  const after = psm.decodeSeatManagerAuthority((await conn.getAccountInfo(psm.seatManager(marketPk), "confirmed")).data);
  if (!after.equals(pauser.publicKey)) throw new Error(`handoff did not take: SM authority ${after.toBase58()}`);
  rec.seatManagerAuthority = after.toBase58();
}
// Faucet-first SOL top-up (payer transfer only if the faucet refuses and fallback allowed). Returns { sig, source }.
async function airdropFirst(who, label, sol, payer, fallback) {
  const target = Math.round(sol * LAMPORTS_PER_SOL); let b = await conn.getBalance(who); const out = {};
  if (b >= target * 0.9) return out;
  const air = new Connection(AIRDROP_RPC, "confirmed");
  for (let i = 1; i <= 4 && b < target * 0.9; i++) {
    try {
      const sig = await air.requestAirdrop(who, target - b);
      for (let j = 0; j < 30 && b < target * 0.9; j++) { await sleep(2000); b = await conn.getBalance(who); }
      if (b >= target * 0.9) { out.sig = sig; out.source = "airdrop"; console.log(`  ${label} airdrop ${sol} SOL: ${sig}`); }
    } catch (e) { console.log(`  ${label} airdrop attempt ${i} failed: ${String(e.message || e).slice(0, 200)}`); await sleep(5000 * i); }
  }
  if (b < target * 0.9 && fallback) {
    out.sig = await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: who, lamports: target - b })], [payer], `${label} ${((target - b) / 1e9).toFixed(3)} SOL (payer fallback; faucet refused)`);
    out.source = "payer";
  } else if (b < target * 0.9) console.log(`  WARNING ${label} has ${b / 1e9} SOL (< ${sol}); faucet refused and payer fallback disabled — fund it manually`);
  return out;
}
const smPda = (symbol, expiry, strike) => PublicKey.findProgramAddressSync([Buffer.from("strike_market"), Buffer.from(pad8(symbol)), i64(expiry),
  u64(BigInt(Math.round(strike * 1e6)))], PROGRAM_ID)[0];

// DRY_RUN=1: offline plan only (no Connection use, no signing).
function dryRun() {
  const pub = (n) => kp(n).publicKey.toBase58();
  const ct = (t) => new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false }) + " CT";
  const wb = walletBPub();
  console.log("[DRY_RUN] offline plan — no RPC calls, no transactions");
  console.log(`  program ${PROGRAM_ID.toBase58()}  phoenix ${PHX.toBase58()}  SHORT_PHASE=${SHORT_PHASE}  NBOOKS=${NBOOKS}`);
  console.log(`  payer ${pub("upgrade-authority")}  keeper ${pub("keeper")}  admin(mUSDC mint auth) ${pub("admin")}  maker ${pub("maker")}  trader ${pub("trader")}  mUSDC ${pub("usdc-mint")}`);
  console.log(`  SOL top-ups from payer: keeper 0.25 / admin 0.05 / maker 0.15 / trader 0.1 (only if < 50%)`);
  console.log(`  mUSDC: maker 2,000,000 / trader 10,000 (admin mint_to, once)`);
  if (process.env.DEBU_WALLET) console.log(`  Debu wallet ${process.env.DEBU_WALLET}: ${process.env.DEBU_SOL ?? 2} SOL (payer transfer) + 10,000 mUSDC (admin mint_to)`);
  if (wb) console.log(`  wallet B ${wb.toBase58()}: top up to ${WALLET_B_SOL} SOL via faucet airdrop (${AIRDROP_RPC})` +
    `${WALLET_B_PAYER_FALLBACK ? ", payer transfer only if the faucet refuses" : ", NO payer fallback"} + ${WALLET_B_USDC} mUSDC (ATA + admin mint_to)`);
  else console.log(`  wallet B: MISSING (${WALLET_B_KEY} not found, WALLET_B unset) — would skip`);
  const st = settlerPub();
  if (st) console.log(`  settler ${st.toBase58()} (M3, permissionless settle signer/payer; NOT the authority): top up to ${SETTLER_SOL} SOL via faucet airdrop (${AIRDROP_RPC})` +
    `${SETTLER_PAYER_FALLBACK ? ", payer transfer only if the faucet refuses" : ", NO payer fallback"}`);
  else console.log(`  settler: MISSING (${SETTLER_KEY}) — permissionless settle would fall back to keeper`);
  const pz = pauserKp();
  if (pz) console.log(`  pauser ${pz.publicKey.toBase58()} (Phoenix seat-manager authority after the handoff; pauses books at expiry): top up to ${PAUSER_SOL} SOL via faucet airdrop` +
    `${PAUSER_PAYER_FALLBACK ? ", payer transfer only if the faucet refuses" : ", NO payer fallback"}; every new/existing book: PSM NameSuccessor(payer → pauser) + ClaimSeatManagerAuthority right after the book is created`);
  else console.log(`  pauser: MISSING (${PAUSER_KEY}) — books would stay on the payer's seat-manager authority and could NOT be paused by automation`);
  let tp = null;
  if (!DAILY_MARKETS) console.log("  daily markets: OFF (BOOTSTRAP_DAILY_MARKETS!=1) — the Railway worker is the only creator");
  try { tp = todayPlan(Math.floor(Date.now() / 1000)); } catch (e) { console.log(`  today's plan: NONE — ${e.message}`); }
  if (tp) console.log(`  session ${tp.dateKey}: expiry = 16:00 ET today = ${ct(tp.closeTs)} (DLV-118; never a next-close date)`);
  if (tp && DAILY_MARKETS && SHORT_PHASE !== "only") tp.regular.forEach((p) => {
    console.log(`  market ${p.symbol} ≥ ${p.strike} (ref ${Number(p.refE6) / 1e6}, ${p.refSource}) exp ${ct(p.expiry)} → ${smPda(p.symbol, p.expiry, p.strike).toBase58()}  book=${p.book}${p.book ? ` (Phoenix Yes/mUSDC, maker 3000 pairs, 5-level ladder @ fair ${p.fair})` : ""}`);
  });
  if (tp && SHORT_PHASE !== "skip") {
    const now = Math.floor(Date.now() / 1000), exp = now + SHORT_MIN * 60 + SHORT_SETUP_SECS;
    console.log(`  short market ${tp.short.symbol} ≥ ${tp.short.strike} (ATM) book=${SHORT_BOOK}${SHORT_BOOK ? " (Phoenix Yes/mUSDC, maker 3000 pairs, 5-level ladder @ fair 0.5)" : ""}: ` +
      `expiry = chain time at START + ${SHORT_MIN} min + ${SHORT_SETUP_SECS}s setup (if started now: ${ct(exp)}; admin_settle ≥ ${ct(exp + 300)}, pipeline settles ≈ ${ct(exp + 330)})`);
  }
  if (fs.existsSync(STATE)) console.log(`  note: existing state ${STATE} will be resumed (idempotent)`);
  console.log("[DRY_RUN] done — 0 transactions sent");
}

async function main() {
  if (DRY_RUN) return dryRun();
  if (!IDL) throw new Error("MERIDIAN_IDL required (prod IDL matching the deployed .so)");
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { markets: [] };
  const save = () => { state.sigs = (state.sigs || []).concat(sigs.splice(0)); writeFileAtomicSync(STATE, JSON.stringify(state, null, 2)); };
  const payer = kp("upgrade-authority"), keeper = kp("keeper"), admin = kp("admin"), maker = kp("maker"), trader = kp("trader"), usdcKp = kp("usdc-mint");
  const usdc = usdcKp.publicKey;
  Object.assign(state, { rpcUsed: RPC, programId: PROGRAM_ID.toBase58(), usdcMint: usdc.toBase58(), keeper: keeper.publicKey.toBase58(),
    admin: admin.publicKey.toBase58(), maker: maker.publicKey.toBase58(), trader: trader.publicKey.toBase58(), upgradeAuthority: payer.publicKey.toBase58(),
    phoenixProgram: PHX.toBase58(), phoenixSeatManager: PSM.toBase58(), label: process.env.DRYRUN_LABEL || "devnet" });
  console.log("payer", payer.publicKey.toBase58(), (await conn.getBalance(payer.publicKey)) / 1e9, "SOL");

  // 0. SOL top-ups from payer
  const want = [[keeper, 0.25], [admin, 0.05], [maker, 0.15], [trader, 0.1]];
  const tops = [];
  for (const [k, sol] of want) { const b = await conn.getBalance(k.publicKey); if (b < sol * 0.5 * LAMPORTS_PER_SOL) tops.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) - b })); }
  if (tops.length) await send(tops, [payer], "SOL top-ups");

  // 1. mUSDC (6 dp) — mint authority = admin; treasury = admin ATA
  if (!(await conn.getAccountInfo(usdc))) {
    const lam = await spl.getMinimumBalanceForRentExemptMint(conn);
    await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: usdc, space: spl.MINT_SIZE, lamports: lam, programId: spl.TOKEN_PROGRAM_ID }),
      spl.createInitializeMint2Instruction(usdc, 6, admin.publicKey, null)], [payer, usdcKp], "create mUSDC mint");
  }
  const treasury = spl.getAssociatedTokenAddressSync(usdc, admin.publicKey);
  const ataFor = (owner) => spl.getAssociatedTokenAddressSync(usdc, owner);
  await send([
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, treasury, admin.publicKey, usdc),
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataFor(maker.publicKey), maker.publicKey, usdc),
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataFor(trader.publicKey), trader.publicKey, usdc),
  ], [payer], "mUSDC ATAs (treasury/maker/trader)");
  if (!state.usdcFunded) {
    await send([spl.createMintToInstruction(usdc, ataFor(maker.publicKey), admin.publicKey, 2_000_000_000_000n),   // 2M
      spl.createMintToInstruction(usdc, ataFor(trader.publicKey), admin.publicKey, 10_000_000_000n)],              // 10k
      [payer, admin], "mint mUSDC to maker 2M / trader 10k");
    state.usdcFunded = true; save();
  }
  state.treasury = treasury.toBase58();

  // 1b. Debu's Phantom devnet wallet (public address from Debu): ~2 SOL + 10k mUSDC + its mUSDC ATA. Nothing else (seat is auto-claimed by the app).
  if (process.env.DEBU_WALLET) {
    const debu = new PublicKey(process.env.DEBU_WALLET);
    state.debuWallet = debu.toBase58(); state.debuFunding = state.debuFunding || {};
    const debuSol = Number(process.env.DEBU_SOL ?? 2);
    const b = await conn.getBalance(debu);
    if (!state.debuFunding.solSig && b < debuSol * 0.9 * LAMPORTS_PER_SOL) {
      state.debuFunding.solSig = await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: debu, lamports: Math.round(debuSol * LAMPORTS_PER_SOL) })], [payer], `Debu wallet ${debuSol} SOL`);
      save();
    }
    if (!state.debuFunding.usdcSig) {
      state.debuFunding.usdcAta = ataFor(debu).toBase58();
      state.debuFunding.usdcSig = await send([spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataFor(debu), debu, usdc),
        spl.createMintToInstruction(usdc, ataFor(debu), admin.publicKey, 10_000_000_000n)], [payer, admin], "Debu wallet mUSDC ATA + 10k mUSDC");
      save();
    }
  }

  // 1c. Wallet B — counterparty that fills Debu's resting limit (STAGING_TEST_PLAN §1.5/§4). SOL from the devnet faucet
  //     (airdrop) first; payer transfer only as a fallback when the faucet refuses. mUSDC via the same admin mint_to path.
  const wb = walletBPub();
  if (wb) {
    state.walletB = wb.toBase58(); state.walletBFunding = state.walletBFunding || {}; const f = state.walletBFunding;
    const target = Math.round(WALLET_B_SOL * LAMPORTS_PER_SOL);
    let b = await conn.getBalance(wb);
    if (b < target * 0.9) {
      const air = new Connection(AIRDROP_RPC, "confirmed");
      for (let i = 1; i <= 4 && b < target * 0.9; i++) {
        try {
          const sig = await air.requestAirdrop(wb, target - b);
          for (let j = 0; j < 30 && b < target * 0.9; j++) { await sleep(2000); b = await conn.getBalance(wb); }
          if (b >= target * 0.9) { f.solSig = sig; f.solSource = "airdrop"; console.log(`  wallet B airdrop ${WALLET_B_SOL} SOL: ${sig}`); }
        } catch (e) { console.log(`  wallet B airdrop attempt ${i} failed: ${String(e.message || e).slice(0, 200)}`); await sleep(5000 * i); }
      }
      if (b < target * 0.9 && WALLET_B_PAYER_FALLBACK) {
        f.solSig = await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wb, lamports: target - b })], [payer], `wallet B ${((target - b) / 1e9).toFixed(3)} SOL (payer fallback; faucet refused)`);
        f.solSource = "payer";
      } else if (b < target * 0.9) console.log(`  WARNING wallet B has ${b / 1e9} SOL (< ${WALLET_B_SOL}); faucet refused and WALLET_B_PAYER_FALLBACK=0 — fund it manually`);
      save();
    }
    if (!f.usdcSig) {
      f.usdcAta = ataFor(wb).toBase58();
      f.usdcSig = await send([spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataFor(wb), wb, usdc),
        spl.createMintToInstruction(usdc, ataFor(wb), admin.publicKey, BigInt(Math.round(WALLET_B_USDC * 1e6)))], [payer, admin], `wallet B mUSDC ATA + ${WALLET_B_USDC} mUSDC`);
      save();
    }
    console.log(`  wallet B ${wb.toBase58()}: ${(await conn.getBalance(wb)) / 1e9} SOL (${f.solSource || "pre-funded"}), mUSDC ATA ${f.usdcAta}`);
  } else console.log(`  wallet B: skipped (${WALLET_B_KEY} missing and WALLET_B unset)`);

  // 1d. Settler (Reviewers M3 / !70): separate low-balance key that signs + pays permissionless settle. Faucet first.
  const st = settlerPub();
  if (st) {
    if (st.equals(keeper.publicKey)) throw new Error("settler key must differ from the config authority (keeper)");
    state.settler = st.toBase58(); state.settlerFunding = state.settlerFunding || {};
    const r = await airdropFirst(st, "settler", SETTLER_SOL, payer, SETTLER_PAYER_FALLBACK);
    if (r.sig) Object.assign(state.settlerFunding, { solSig: r.sig, solSource: r.source });
    save();
    console.log(`  settler ${st.toBase58()}: ${(await conn.getBalance(st)) / 1e9} SOL (${state.settlerFunding.solSource || "pre-funded"})`);
  } else console.log(`  settler: skipped (${SETTLER_KEY} missing) — permissionless settle falls back to keeper`);

  // 1e. Pauser (review dd46769): Phoenix seat-manager authority after the handoff; pays PSM ChangeMarketStatus fees.
  const pauser = pauserKp();
  if (pauser) {
    for (const [k, n] of [[payer, "payer (upgrade key)"], [keeper, "config authority (keeper)"]]) if (pauser.publicKey.equals(k.publicKey)) throw new Error(`pauser key must differ from the ${n}`);
    if (st && pauser.publicKey.equals(st)) throw new Error("pauser key must differ from the settler");
    state.pauser = pauser.publicKey.toBase58(); state.pauserFunding = state.pauserFunding || {};
    const r = await airdropFirst(pauser.publicKey, "pauser", PAUSER_SOL, payer, PAUSER_PAYER_FALLBACK);
    if (r.sig) Object.assign(state.pauserFunding, { solSig: r.sig, solSource: r.source });
    save();
    console.log(`  pauser ${pauser.publicKey.toBase58()}: ${(await conn.getBalance(pauser.publicKey)) / 1e9} SOL (${state.pauserFunding.solSource || "pre-funded"})`);
  } else console.log(`  WARNING pauser: skipped (${PAUSER_KEY} missing) — books stay on the payer's seat-manager authority; automation can't pause them`);

  // 2. Config (authority = keeper = AUTOMATION_KEYPAIR)
  const idl = JSON.parse(fs.readFileSync(IDL, "utf8")); idl.address = PROGRAM_ID.toBase58();
  const prog = (k) => new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(k), { commitment: "confirmed" }));
  const pk = prog(keeper), pm = prog(maker);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  state.configPda = configPda.toBase58();
  if (!(await conn.getAccountInfo(configPda))) {
    const params = { mintFeeBps: 0, redeemFeeBps: 0, settleMaxStalenessSlots: new anchor.BN(150), settleMaxConfRatioBps: 200, adminSettleDelaySecs: new anchor.BN(ADMIN_SETTLE_DELAY_SECS) };
    const ix = await pk.methods.initializeConfig(params).accounts({ authority: keeper.publicKey, config: configPda, collateralMint: usdc, treasury, systemProgram: SystemProgram.programId }).instruction();
    await send([ix], [keeper], "initialize_config");
  }
  state.configParams = { mintFeeBps: 0, redeemFeeBps: 0, settleMaxStalenessSlots: 150, settleMaxConfRatioBps: 200, adminSettleDelaySecs: ADMIN_SETTLE_DELAY_SECS };
  save();

  // 3. Strike markets (+ short-expiry settle-test market)
  //    DLV-118: today's markets (expiry 16:00 ET today, ATM strikes from TODAY_PLAN). SHORT_PHASE=skip → today's markets only;
  //    =only → just the 20-min market (run-staging.sh starts it on Debu's START signal).
  //    ONE CREATOR: daily markets only with BOOTSTRAP_DAILY_MARKETS=1 (default off — the Railway worker creates them).
  const nowChain = await conn.getBlockTime(await conn.getSlot());
  const needPlan = (SHORT_PHASE !== "only" && DAILY_MARKETS) || (SHORT_PHASE !== "skip" && !state.shortPlan);
  const tp = needPlan ? todayPlan(nowChain) : null;
  if (tp) { state.todayPlan = { dateKey: tp.dateKey, closeTs: tp.closeTs }; save(); }
  if (SHORT_PHASE !== "only" && !DAILY_MARKETS) console.log("\ndaily markets: OFF (BOOTSTRAP_DAILY_MARKETS!=1) — the Railway worker is the only creator; no daily markets or books here");
  const plan = SHORT_PHASE === "only" || !DAILY_MARKETS ? [] : tp.regular.map((p) => ({ ...p }));
  if (plan.length) {
    // L-2: never double a same-day market another creator (the Railway worker, an earlier run) already made.
    const existing = (await pk.account.strikeMarket.all()).map((m) => ({
      symbol: Buffer.from(m.account.equitySymbol).toString("utf8").replace(/[\s\0]+$/, ""), expiry: Number(m.account.expiryTs.toString()), market: m.publicKey.toBase58() }));
    const withPda = plan.map((p) => ({ ...p, market: PublicKey.findProgramAddressSync([Buffer.from("strike_market"), Buffer.from(pad8(p.symbol)), i64(p.expiry), u64(BigInt(Math.round(p.strike * 1e6)))], PROGRAM_ID)[0].toBase58() }));
    const dups = sameDayDuplicates(withPda, existing);
    for (const d of dups) console.log(`  ALERT skip ${d.symbol}: same-day market(s) already exist ${d.existing.join(",")} (L-2: no duplicate set / book)`);
    const skip = new Set(dups.map((d) => d.symbol));
    for (let i = plan.length - 1; i >= 0; i--) if (skip.has(plan[i].symbol)) plan.splice(i, 1);
  }
  if (SHORT_PHASE !== "skip") {
    if (!state.shortPlan) {
      // Expiry is fixed at creation (it is a PDA seed): chain time now + SHORT_MIN + setup buffer for the book + ladder,
      // capped at today's 16:00 ET close (L-4: refused when it would not fit).
      const s = await conn.getSlot(); const bt = await conn.getBlockTime(s);
      state.shortPlan = { symbol: tp.short.symbol, strike: tp.short.strike, expiry: shortExpiryFor(tp, bt, SHORT_MIN, SHORT_SETUP_SECS), book: SHORT_BOOK, fair: 0.5, short: true, startedChainTs: bt };
      save();
    }
    plan.push(state.shortPlan);
  }
  for (const p of plan) {
    const strikeE6 = BigInt(Math.round(p.strike * 1e6));
    const [sm] = PublicKey.findProgramAddressSync([Buffer.from("strike_market"), Buffer.from(pad8(p.symbol)), i64(p.expiry), u64(strikeE6)], PROGRAM_ID);
    let rec = state.markets.find((m) => m.market === sm.toBase58());
    if (!rec) { rec = { symbol: p.symbol, strikeE6: Number(strikeE6), expiryTs: p.expiry, market: sm.toBase58(), short: !!p.short, pythPriceFeed: FEEDS[p.symbol][0] }; state.markets.push(rec); }
    console.log(`\n${p.symbol} ≥ ${p.strike} exp ${new Date(p.expiry * 1000).toISOString()} → ${rec.market}`);
    if (!(await conn.getAccountInfo(sm))) {
      const ix = await pk.methods.createStrikeMarket({ equitySymbol: pad8(p.symbol), strikePriceE6: new anchor.BN(strikeE6.toString()), expiryTs: new anchor.BN(p.expiry),
        pythFeedId: Array.from(Buffer.from(FEEDS[p.symbol][1], "hex")), phoenixMarket: PublicKey.default })
        .accounts({ authority: keeper.publicKey, config: configPda, strikeMarket: sm, collateralMint: usdc, pythPriceFeed: new PublicKey(FEEDS[p.symbol][0]) }).instruction();
      await send([ix], [keeper], "create_strike_market");
    }
    const smAcc = await pk.account.strikeMarket.fetch(sm);
    rec.yesMint = smAcc.yesMint.toBase58(); rec.noMint = smAcc.noMint.toBase58(); rec.collateralVault = smAcc.collateralVault.toBase58();
    save();
    if (!p.book) continue;

    // 4. Phoenix V1 Yes/USDC book, authority → Seat Manager (permissionless ClaimSeat)
    let marketPk = smAcc.phoenixMarket && !smAcc.phoenixMarket.equals(PublicKey.default) ? smAcc.phoenixMarket : (rec.phoenixMarket ? new PublicKey(rec.phoenixMarket) : null);
    if (!marketPk || !(await conn.getAccountInfo(marketPk))) {
      const mk = Keypair.generate(); marketPk = mk.publicKey; rec.phoenixMarket = marketPk.toBase58(); save();
      const lamports = await conn.getMinimumBalanceForRentExemption(MARKET_SPACE);
      await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: marketPk, lamports, space: MARKET_SPACE, programId: PHX }),
        initMarketIx(marketPk, smAcc.yesMint, usdc, payer.publicKey)], [payer, mk], "phoenix InitializeMarket", 1_400_000);
      await send([authIx(103, Buffer.from([1]), marketPk, payer.publicKey, true), authIx(102, phx.getSeatManagerAddress(marketPk).toBuffer(), marketPk, payer.publicKey, false),
        psmClaimIx(marketPk, payer.publicKey)], [payer], "activate + seat-manager authority");
    }
    rec.phoenixMarket = marketPk.toBase58(); save();
    // 4b. right after the book exists under the Seat Manager: SM authority payer → pauser (also catches older books)
    if (pauser) { await handoffToPauser(marketPk, payer, pauser, rec); save(); }
    if (!smAcc.phoenixMarket.equals(marketPk)) {
      const ix = await pk.methods.setPhoenixMarket(marketPk).accounts({ authority: keeper.publicKey, config: configPda, strikeMarket: sm }).instruction();
      await send([ix], [keeper], "set_phoenix_market");
    }
    // maker: ATAs + seat + mint pairs + ladder
    const client0 = await phx.Client.createWithoutConfig(conn, [marketPk], false);
    const lad0 = client0.getUiLadder(marketPk.toBase58(), 3);
    if ((lad0.bids || []).length && (lad0.asks || []).length) { console.log("  already seeded", JSON.stringify(lad0)); rec.fairYes = p.fair; save(); continue; }
    const mYes = spl.getAssociatedTokenAddressSync(smAcc.yesMint, maker.publicKey), mNo = spl.getAssociatedTokenAddressSync(smAcc.noMint, maker.publicKey);
    await send([spl.createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, mYes, maker.publicKey, smAcc.yesMint),
      spl.createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, mNo, maker.publicKey, smAcc.noMint), phx.getClaimSeatIx(marketPk, maker.publicKey)], [maker], "maker ATAs + ClaimSeat (PSM)");
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), sm.toBuffer()], PROGRAM_ID);
    const PAIRS = 3000;
    const mintIx = await pm.methods.mint(new anchor.BN(PAIRS * 1_000_000)).accounts({ user: maker.publicKey, config: configPda, strikeMarket: sm, collateralVault: smAcc.collateralVault,
      vaultAuthority, userCollateralAta: ataFor(maker.publicKey), userYesAta: mYes, userNoAta: mNo, yesMint: smAcc.yesMint, noMint: smAcc.noMint, treasury, collateralMint: usdc,
      tokenProgram: spl.TOKEN_PROGRAM_ID, simClock: null }).instruction();
    await send([mintIx], [maker], `maker mint ${PAIRS} pairs`);
    const ixs = []; const key = marketPk.toBase58(); const fair = p.fair;
    for (let k = 1; k <= 5; k++) {
      const ask = Math.round((fair + 0.01 + (k - 1) * 0.02) * 100) / 100, bid = Math.round((fair - 0.01 - (k - 1) * 0.02) * 100) / 100, size = 100 * k;
      ixs.push(client0.getPostOnlyOrderInstructionfromTemplate(key, maker.publicKey, { side: phx.Side.Ask, priceAsFloat: ask, sizeInBaseUnits: size, clientOrderId: 1000 + k, rejectPostOnly: false, useOnlyDepositedFunds: false }));
      ixs.push(client0.getPostOnlyOrderInstructionfromTemplate(key, maker.publicKey, { side: phx.Side.Bid, priceAsFloat: bid, sizeInBaseUnits: size, clientOrderId: 2000 + k, rejectPostOnly: false, useOnlyDepositedFunds: false }));
    }
    await send(ixs, [maker], `maker ladder (fair ${fair})`, 1_400_000);
    const fresh = await phx.Client.createWithoutConfig(conn, [marketPk], false);
    console.log("  book", JSON.stringify(fresh.getUiLadder(key, 3)));
    rec.fairYes = fair; save();
  }
  state[SHORT_PHASE === "only" ? "shortBootstrappedAt" : "bootstrappedAt"] = new Date().toISOString(); save();
  const sr = state.markets.find((m) => m.short);
  if (sr && SHORT_PHASE !== "skip") console.log(`\nSHORT_READY market=${sr.market} phoenix=${sr.phoenixMarket || "none"} expiryTs=${sr.expiryTs}`);
  console.log("\npayer left", (await conn.getBalance(payer.publicKey)) / 1e9, "SOL; wrote", STATE);
}
main().catch((e) => { console.error(e); if (e.logs) console.error(e.logs.join("\n")); process.exit(1); });
