#!/usr/bin/env node
/**
 * Settle the Docker localnet's expired markets (LOCALNET ONLY). For each market in /data/state/today-markets.json that
 * is past expiry and still Open: post a fresh mock Pyth price, then call the permissionless `settle` (same D-005 gates
 * as always: staleness + confidence, Yes iff price ≥ strike).
 *
 *   node docker/localnet/settle.cjs                 # settle at each market's reference price
 *   node docker/localnet/settle.cjs AAPL=230 NVDA=131.5   # choose the close per symbol (forces YesWins / NoWins)
 *
 * Books are not paused here (the Railway worker's pauser does that on devnet); after settle the program refuses new
 * mints, and the web app hides the book on a settled market.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const W = "/repo/apps/web/node_modules/";
const web3 = require(W + "@solana/web3.js");
const anchor = require(W + "@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram } = web3;

const RPC = "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");
const kp = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

function parseCloses(args) {
  const out = {};
  for (const a of args) {
    const m = /^([A-Za-z]{1,8})=([0-9]+(?:\.[0-9]{1,6})?)$/.exec(a);
    if (!m) throw new Error(`bad argument "${a}" (want SYMBOL=123.45)`);
    out[m[1].toUpperCase()] = Math.round(Number(m[2]) * 1e6);
  }
  return out;
}

async function main() {
  const closes = parseCloses(process.argv.slice(2));
  const conn = new Connection(RPC, "confirmed");
  const authority = kp("/data/keys/authority.json");
  const idl = JSON.parse(fs.readFileSync("/repo/target/idl/meridian.json", "utf8"));
  const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(authority), { commitment: "confirmed" }));
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  const state = JSON.parse(fs.readFileSync("/data/state/today-markets.json", "utf8"));
  const slot = await conn.getSlot("confirmed");
  const now = await conn.getBlockTime(slot);
  let done = 0, waiting = 0;
  for (const rec of state.markets) {
    const marketPk = new PublicKey(rec.market);
    const sm = await program.account.strikeMarket.fetch(marketPk);
    const status = Object.keys(sm.status)[0];
    if (status !== "open") continue;
    const expiry = Number(sm.expiryTs.toString());
    if (expiry > now) { waiting++; console.log(`${rec.symbol} ≥ ${rec.strikeE6 / 1e6}: expires in ${Math.ceil((expiry - now) / 60)} min — not yet`); continue; }
    const priceE6 = closes[rec.symbol] ?? rec.refE6;
    const feed = kp(rec.pythKeypairPath);
    await program.methods.upsertMockPyth({ price: new anchor.BN(priceE6).mul(new anchor.BN(100)), conf: new anchor.BN(1000), expo: -8,
      publishSlot: new anchor.BN(slot), feedId: Array.from(Buffer.from(rec.feedIdHex, "hex")) })
      .accounts({ payer: authority.publicKey, pythPriceFeed: feed.publicKey, systemProgram: SystemProgram.programId }).signers([feed]).rpc();
    const sig = await program.methods.settle()
      .accounts({ settler: authority.publicKey, config: configPda, strikeMarket: marketPk, pythPriceFeed: feed.publicKey, simClock: null }).rpc();
    const after = await program.account.strikeMarket.fetch(marketPk);
    console.log(`${rec.symbol} ≥ ${rec.strikeE6 / 1e6}: settled at ${priceE6 / 1e6} → ${Object.keys(after.status)[0]} (${sig})`);
    done++;
  }
  console.log(`settled ${done}, not expired yet ${waiting}`);
}

main().catch((e) => { console.error("settle FAILED:", e); process.exit(1); });
