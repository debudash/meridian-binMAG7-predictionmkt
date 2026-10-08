#!/usr/bin/env node
/**
 * DLV-118 — LOCALNET ONLY: create TODAY's-close 0DTE markets for all 7 MAG7 tickers (SPEC §1 / §3.3), each with a
 * mock Pyth feed, a Phoenix V1 Yes/USDC book (Seat Manager authority) and a maker ladder. ADDITIVE: never wipes,
 * reseeds or edits existing markets; never touches the SimClock (read-only).
 *
 *   node scripts/localnet/today-markets.cjs            (or DRY_RUN=1 to print the plan only)
 *
 * Expiry = 16:00 America/New_York on the EFFECTIVE day: SimClock.unix_timestamp when the SimClock PDA exists and is
 * enabled (D-017 anytime testing: set/warp the sim clock first on a validator where that's allowed), else chain time.
 * At/after that close it REFUSES (same-day only, never rolls to tomorrow). Weekends/holidays refuse unless
 * ALLOW_NON_TRADING_DAY=1. Idempotent: an existing market PDA (same symbol/expiry/strike) is reused; a book is only
 * created when the market has none.
 *
 * env:
 *   RPC                 default http://127.0.0.1:8899 (must be 127.0.0.1/localhost)
 *   AUTH                config authority keypair (default ~/.config/solana/id.json; also the fixture USDC mint authority)
 *   MAKER               maker keypair (default /workspace/meridian-localnet-maker.json)
 *   MERIDIAN_IDL        FULL localnet IDL (localnet-test build; default <repo>/target/idl/meridian.json)
 *   MERIDIAN_PROGRAM_ID default 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6
 *   WEB_NODE_MODULES    dir with @solana/web3.js, @solana/spl-token, @coral-xyz/anchor, @ellipsis-labs/phoenix-sdk
 *                       (default <repo>/apps/web/node_modules)
 *   AUTO_DIST           apps/automation/dist (built; provides marketDay.js) (default <repo>/apps/automation/dist)
 *   SYMBOLS             default all MAG7; REF_PRICES e.g. "AAPL=227.31,MSFT=415" (default: localnet mock levels)
 *   STATE_OUT           default /workspace/meridian-localnet-today-<dateKey>.json (feed keypairs next to it, 0600)
 *   MAKER_PAIRS         default 3000
 *   ANYTIME_EXPIRY_MINUTES  D-017 anytime play (Docker localnet): expiry = now + N minutes instead of today's 16:00 ET
 *                       close, ignoring the ET calendar (5..10080). Unset = the same-day rule above.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const REPO = path.resolve(__dirname, "..", "..");
const W = (process.env.WEB_NODE_MODULES || path.join(REPO, "apps/web/node_modules")).replace(/\/?$/, "/");
const web3 = require(W + "@solana/web3.js");
const spl = require(W + "@solana/spl-token");
const anchor = require(W + "@coral-xyz/anchor");
const phx = require(W + "@ellipsis-labs/phoenix-sdk");
const md = require(path.join(process.env.AUTO_DIST || path.join(REPO, "apps/automation/dist"), "marketDay.js"));
const { planTodayMarkets, parseRefPrices } = require("./lib/today-plan.cjs");
const { PublicKey, Keypair, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, Connection, LAMPORTS_PER_SOL } = web3;

// DLV-119 nit: no default — the operator names the validator explicitly (e.g. RPC=http://127.0.0.1:8699 for a temp one).
const RPC = process.env.RPC;
if (!RPC) throw new Error("RPC required (explicit local validator URL, e.g. RPC=http://127.0.0.1:8899) — no default");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(RPC)) throw new Error(`today-markets is LOCALNET ONLY; refusing RPC ${RPC}`);
const DRY_RUN = process.env.DRY_RUN === "1";
const AUTH = process.env.AUTH || `${process.env.HOME}/.config/solana/id.json`;
const MAKER = process.env.MAKER || "/workspace/meridian-localnet-maker.json";
const IDL = process.env.MERIDIAN_IDL || path.join(REPO, "target/idl/meridian.json");
const PROGRAM_ID = new PublicKey(process.env.MERIDIAN_PROGRAM_ID || "9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");
const SYMBOLS = (process.env.SYMBOLS || md.MAG7.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const PAIRS = Number(process.env.MAKER_PAIRS || 3000);
const PHX = new PublicKey("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
const MARKET_SPACE = 232544; // (512 bids, 512 asks, 1153 seats) — PSM requires seats = bids+asks+1+128
const LOG_AUTH = phx.getLogAuthority();

const kp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pad8 = (s) => { const b = Buffer.alloc(8, 0x20); Buffer.from(s).copy(b); return b; };
const vault = (market, mint) => PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer(), mint.toBuffer()], PHX)[0];
const ct = (ts) => new Date(ts * 1000).toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false }) + " CT";

async function send(conn, ixs, signers, label) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  const sig = await web3.sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log(`  ${label}: ${sig}`);
  return sig;
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
const PSM = new PublicKey("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1");
const psmClaimMarketAuthorityIx = (market, payer) => new TransactionInstruction({ programId: PSM, data: Buffer.from([0]), keys: [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: LOG_AUTH, isSigner: false, isWritable: false },
  { pubkey: market, isSigner: false, isWritable: true }, { pubkey: phx.getSeatManagerAddress(market), isSigner: false, isWritable: true },
  { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: phx.getSeatDepositCollectorAddress(market), isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } ] });

/** Effective clock, READ-ONLY: SimClock {authority 32, ts i64, slot u64, enabled u8} when enabled, else chain time. */
async function effectiveClock(conn) {
  const [simPda] = PublicKey.findProgramAddressSync([Buffer.from("sim_clock")], PROGRAM_ID);
  const info = await conn.getAccountInfo(simPda, "confirmed");
  const slot = await conn.getSlot("confirmed");
  if (info && info.owner.equals(PROGRAM_ID) && info.data.length >= 57) {
    const d = info.data;
    const enabled = d[56] === 1;
    const sim = { pda: simPda, ts: Number(d.readBigInt64LE(40)), slot: Number(d.readBigUInt64LE(48)), enabled };
    if (enabled) return { source: "sim_clock", nowSec: sim.ts, slot: sim.slot, simClockPda: simPda, sim };
    return { source: "chain (SimClock present but disabled)", nowSec: await conn.getBlockTime(slot), slot, simClockPda: simPda, sim };
  }
  return { source: "chain (no SimClock)", nowSec: await conn.getBlockTime(slot), slot, simClockPda: null, sim: null };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const clock = await effectiveClock(conn);
  console.log(`effective clock: ${clock.source} now=${clock.nowSec} (${ct(clock.nowSec)}) slot=${clock.slot}` +
    (clock.sim ? ` | SimClock ${clock.simClockPda.toBase58()} enabled=${clock.sim.enabled} ts=${clock.sim.ts}` : ""));
  const plan = planTodayMarkets(md, {
    nowSec: clock.nowSec, symbols: SYMBOLS, refPricesE6: parseRefPrices(process.env.REF_PRICES), allowNonTradingDay: process.env.ALLOW_NON_TRADING_DAY === "1",
    anytimeExpirySecs: process.env.ANYTIME_EXPIRY_MINUTES ? Number(process.env.ANYTIME_EXPIRY_MINUTES) * 60 : undefined,
  });
  if (!plan.ok) {
    console.error(`${plan.code === "early_close" || plan.code === "unknown_year" ? "ALERT " : ""}REFUSED (${plan.code}): ${String(plan.reason).replace(/^ALERT /, "")}${plan.nextDateKey ? ` — next trading day ${plan.nextDateKey}` : ""}`);
    console.error("Same-day markets only (SPEC §1/§3.3). On a validator where it is allowed, set the SimClock into a session first.");
    process.exit(3);
  }
  const { session } = plan;
  console.log(`session ${session.dateKey}: open ${session.openTs} (${ct(session.openTs)}) close/expiry ${session.closeTs} (${ct(session.closeTs)}); ` +
    `${Math.floor((session.closeTs - clock.nowSec) / 60)} min of trading left`);
  const STATE_OUT = process.env.STATE_OUT || `/workspace/meridian-localnet-today-${session.dateKey}.json`;
  const pdaFor = (m) => PublicKey.findProgramAddressSync([Buffer.from("strike_market"), pad8(m.symbol), i64(m.expiryTs), u64(m.strikeE6)], PROGRAM_ID)[0];
  for (const m of plan.markets) {
    console.log(`  ${m.symbol} ≥ ${Number(m.strikeE6) / 1e6} (ref ${Number(m.refE6) / 1e6}, fair Yes ${m.fairYes}) exp ${m.expiryTs} → ${pdaFor(m).toBase58()}`);
  }
  if (DRY_RUN) { console.log("DRY_RUN — no transactions"); return; }

  const authority = kp(AUTH);
  const maker = fs.existsSync(MAKER) ? kp(MAKER) : null;
  if (!maker) throw new Error(`maker keypair missing: ${MAKER}`);
  const idl = JSON.parse(fs.readFileSync(IDL, "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  if (!idl.instructions.some((ix) => ix.name === "upsert_mock_pyth")) throw new Error(`${IDL} is not the localnet-test IDL (no upsert_mock_pyth)`);
  const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(authority), { commitment: "confirmed" }));
  const makerProgram = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(maker), { commitment: "confirmed" }));
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const cfg = await program.account.config.fetch(configPda);
  if (!cfg.authority.equals(authority.publicKey)) throw new Error(`AUTH ${authority.publicKey.toBase58()} is not the config authority ${cfg.authority.toBase58()}`);
  if (cfg.paused) throw new Error("config is paused — create would fail");
  const usdc = cfg.collateralMint;
  const treasury = cfg.treasury;

  // Maker funding (localnet faucet SOL + fixture USDC minted by the authority) — only if low.
  if ((await conn.getBalance(maker.publicKey)) < 20 * LAMPORTS_PER_SOL) {
    const s = await conn.requestAirdrop(maker.publicKey, 50 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(s, "confirmed");
  }
  const makerUsdc = spl.getAssociatedTokenAddressSync(usdc, maker.publicKey);
  const needUsdc = BigInt(PAIRS) * 1_000_000n * BigInt(plan.markets.length) + 100_000_000_000n;
  const mu = await conn.getTokenAccountBalance(makerUsdc).catch(() => null);
  if (!mu || BigInt(mu.value.amount) < needUsdc) {
    await send(conn, [spl.createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, makerUsdc, maker.publicKey, usdc),
      spl.createMintToInstruction(usdc, makerUsdc, authority.publicKey, needUsdc)], [authority], "fund maker USDC");
  }

  const dir = path.dirname(STATE_OUT);
  const state = fs.existsSync(STATE_OUT) ? JSON.parse(fs.readFileSync(STATE_OUT, "utf8")) : { markets: [] };
  Object.assign(state, { kind: "localnet-today-markets (DLV-118)", rpc: RPC, programId: PROGRAM_ID.toBase58(), usdcMint: usdc.toBase58(),
    session, clockSource: clock.source, createdAtEffectiveTs: clock.nowSec, maker: maker.publicKey.toBase58() });
  const save = () => { const tmp = `${STATE_OUT}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2)); fs.renameSync(tmp, STATE_OUT); };

  for (const m of plan.markets) {
    const strikeMarket = pdaFor(m);
    console.log(`\n${m.symbol} ≥ ${Number(m.strikeE6) / 1e6} exp ${ct(m.expiryTs)} → ${strikeMarket.toBase58()}`);
    let rec = state.markets.find((r) => r.market === strikeMarket.toBase58());
    if (!rec) { rec = { symbol: m.symbol, strikeE6: Number(m.strikeE6), expiryTs: m.expiryTs, market: strikeMarket.toBase58(), refE6: Number(m.refE6) }; state.markets.push(rec); }
    if (!(await conn.getAccountInfo(strikeMarket))) {
      const feedPath = path.join(dir, `meridian-localnet-today-feed-${session.dateKey}-${m.symbol}.json`);
      const feed = fs.existsSync(feedPath) ? kp(feedPath) : Keypair.generate();
      if (!fs.existsSync(feedPath)) fs.writeFileSync(feedPath, JSON.stringify(Array.from(feed.secretKey)), { mode: 0o600 });
      const feedId = crypto.createHash("sha256").update(`meridian-localnet-mock-${m.symbol}`).digest();
      await program.methods.upsertMockPyth({ price: new anchor.BN(m.mockPriceE8.toString()), conf: new anchor.BN(1000), expo: -8,
        publishSlot: new anchor.BN(clock.slot), feedId: Array.from(feedId) })
        .accounts({ payer: authority.publicKey, pythPriceFeed: feed.publicKey, systemProgram: SystemProgram.programId }).signers([feed]).rpc()
        .then((s) => console.log(`  upsert_mock_pyth ${feed.publicKey.toBase58()}: ${s}`));
      await program.methods.createStrikeMarket({ equitySymbol: Array.from(pad8(m.symbol)), strikePriceE6: new anchor.BN(m.strikeE6.toString()),
        expiryTs: new anchor.BN(m.expiryTs), pythFeedId: Array.from(feedId), phoenixMarket: PublicKey.default })
        .accounts({ authority: authority.publicKey, config: configPda, strikeMarket, collateralMint: usdc, pythPriceFeed: feed.publicKey }).rpc()
        .then((s) => console.log(`  create_strike_market: ${s}`));
      Object.assign(rec, { pyth: feed.publicKey.toBase58(), pythKeypairPath: feedPath, feedIdHex: feedId.toString("hex"), mockPriceE8: m.mockPriceE8.toString() });
    } else {
      console.log("  market exists — reusing (no create)");
    }
    const sm = await program.account.strikeMarket.fetch(strikeMarket);
    if (Number(sm.expiryTs.toString()) !== session.closeTs) throw new Error(`expiry mismatch on ${strikeMarket.toBase58()}`);
    Object.assign(rec, { yesMint: sm.yesMint.toBase58(), noMint: sm.noMint.toBase58() });
    save();
    if (!sm.phoenixMarket.equals(PublicKey.default) && (await conn.getAccountInfo(sm.phoenixMarket))) {
      rec.phoenixMarket = sm.phoenixMarket.toBase58();
      console.log(`  book already wired: ${rec.phoenixMarket}`);
      save();
      continue;
    }
    // Phoenix book: InitializeMarket → Active → seat-manager authority (any wallet can ClaimSeat), then wire it.
    // DLV-119 nit: the book pubkey is recorded BEFORE InitializeMarket, so a crash before set_phoenix_market re-uses
    // that book on the re-run instead of leaving it orphaned and making another one.
    let mk = null;
    const prior = rec.phoenixMarket && !rec.phoenixWired ? new PublicKey(rec.phoenixMarket) : null;
    const priorAcct = prior ? await conn.getAccountInfo(prior) : null;
    if (prior && priorAcct && priorAcct.owner.equals(PHX)) {
      console.log(`  re-using unwired book from a previous run: ${prior.toBase58()}`);
      await send(conn, [authIx(103, Buffer.from([1]), prior, authority.publicKey, true),
        authIx(102, phx.getSeatManagerAddress(prior).toBuffer(), prior, authority.publicKey, false),
        psmClaimMarketAuthorityIx(prior, authority.publicKey)], [authority], "activate + seat-manager authority (resume)").catch((e) =>
        console.log(`  (activation already done: ${String(e.message || e).slice(0, 80)})`));
      mk = { publicKey: prior };
    } else {
      const kpNew = Keypair.generate();
      rec.phoenixMarket = kpNew.publicKey.toBase58(); rec.phoenixWired = false;
      save();
      const lamports = await conn.getMinimumBalanceForRentExemption(MARKET_SPACE);
      await send(conn, [SystemProgram.createAccount({ fromPubkey: authority.publicKey, newAccountPubkey: kpNew.publicKey, lamports, space: MARKET_SPACE, programId: PHX }),
        initMarketIx(kpNew.publicKey, sm.yesMint, usdc, authority.publicKey)], [authority, kpNew], "phoenix InitializeMarket");
      await send(conn, [authIx(103, Buffer.from([1]), kpNew.publicKey, authority.publicKey, true),
        authIx(102, phx.getSeatManagerAddress(kpNew.publicKey).toBuffer(), kpNew.publicKey, authority.publicKey, false),
        psmClaimMarketAuthorityIx(kpNew.publicKey, authority.publicKey)], [authority], "activate + seat-manager authority");
      mk = kpNew;
    }
    rec.phoenixMarket = mk.publicKey.toBase58();
    save();
    await program.methods.setPhoenixMarket(mk.publicKey).accounts({ authority: authority.publicKey, config: configPda, strikeMarket }).rpc()
      .then((s) => console.log(`  set_phoenix_market: ${s}`));
    rec.phoenixWired = true;
    save();
    // Maker: ATAs + PSM seat, mint pairs (effective clock: pass the SimClock PDA when one exists), post-only ladder.
    const mYes = spl.getAssociatedTokenAddressSync(sm.yesMint, maker.publicKey);
    const mNo = spl.getAssociatedTokenAddressSync(sm.noMint, maker.publicKey);
    await send(conn, [spl.createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, mYes, maker.publicKey, sm.yesMint),
      spl.createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, mNo, maker.publicKey, sm.noMint),
      phx.getClaimSeatIx(mk.publicKey, maker.publicKey)], [maker], "maker ATAs + ClaimSeat (PSM)");
    const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), strikeMarket.toBuffer()], PROGRAM_ID);
    await makerProgram.methods.mint(new anchor.BN(PAIRS * 1_000_000)).accounts({ user: maker.publicKey, config: configPda, strikeMarket,
      collateralVault: sm.collateralVault, vaultAuthority, userCollateralAta: makerUsdc, userYesAta: mYes, userNoAta: mNo, yesMint: sm.yesMint,
      noMint: sm.noMint, treasury, collateralMint: usdc, tokenProgram: spl.TOKEN_PROGRAM_ID, simClock: clock.simClockPda }).rpc()
      .then((s) => console.log(`  maker mint ${PAIRS} pairs: ${s}`));
    const client = await phx.Client.createWithoutConfig(conn, [mk.publicKey], false);
    const key = mk.publicKey.toBase58();
    const ixs = [];
    for (let k = 1; k <= 5; k++) {
      const ask = Math.round((m.fairYes + 0.01 + (k - 1) * 0.02) * 100) / 100;
      const bid = Math.round((m.fairYes - 0.01 - (k - 1) * 0.02) * 100) / 100;
      const size = 100 * k;
      if (ask < 1) ixs.push(client.getPostOnlyOrderInstructionfromTemplate(key, maker.publicKey, { side: phx.Side.Ask, priceAsFloat: ask, sizeInBaseUnits: size, clientOrderId: 1000 + k, rejectPostOnly: false, useOnlyDepositedFunds: false }));
      if (bid > 0) ixs.push(client.getPostOnlyOrderInstructionfromTemplate(key, maker.publicKey, { side: phx.Side.Bid, priceAsFloat: bid, sizeInBaseUnits: size, clientOrderId: 2000 + k, rejectPostOnly: false, useOnlyDepositedFunds: false }));
    }
    await send(conn, ixs, [maker], `maker ladder (fair ${m.fairYes})`);
    const lad = (await phx.Client.createWithoutConfig(conn, [mk.publicKey], false)).getUiLadder(key, 1);
    rec.phoenixFairYes = m.fairYes;
    rec.topOfBook = { bid: lad.bids[0]?.price ?? null, ask: lad.asks[0]?.price ?? null };
    console.log(`  top of book bid ${rec.topOfBook.bid} / ask ${rec.topOfBook.ask}`);
    save();
  }
  console.log(`\nwrote ${STATE_OUT}`);
  console.log(JSON.stringify(state.markets.map((r) => ({ symbol: r.symbol, strike: r.strikeE6 / 1e6, market: r.market, phoenix: r.phoenixMarket, expiryTs: r.expiryTs })), null, 1));
}
main().catch((e) => { console.error(e); if (e.logs) console.error(e.logs.join("\n")); process.exit(1); });
