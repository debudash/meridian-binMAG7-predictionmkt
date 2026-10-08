/**
 * Opt-in localnet proof of the pause mechanism against the real Phoenix + Seat Manager programs.
 *   solana-test-validator --rpc-port 8699 --faucet-port 9699 --reset \
 *     --bpf-program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY phoenix.so \
 *     --bpf-program PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1 seat_manager.so
 *   PHOENIX_LOCALNET_RPC=http://127.0.0.1:8699 npm test -- --grep "localnet PSM"
 * Same book setup as ops/devnet-bootstrap.cjs (InitializeMarket → Active → NameSuccessor(PSM PDA) →
 * PSM ClaimMarketAuthority), then the handoff + pause built by src/phoenix/seatManager.ts.
 */
import { expect } from "chai";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  decodePhoenixMarketStatus,
  decodeSeatManager,
  PHOENIX_PROGRAM_ID as PHX,
  PHOENIX_SEAT_MANAGER_PROGRAM_ID as PSM,
  PhoenixMarketStatus,
  phoenixLogAuthority,
  psmChangeMarketStatusIx,
  seatManagerAddress,
  seatManagerHandoffIxs,
} from "../src/phoenix/seatManager";
import { livePauseDeps, runPausePass } from "../src/phoenix/pauseAtExpiry";

const RPC = process.env.PHOENIX_LOCALNET_RPC;
const MARKET_SPACE = 232544;
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vault = (market: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer(), mint.toBuffer()], PHX)[0];
const depositCollector = (market: PublicKey) => PublicKey.findProgramAddressSync([market.toBuffer(), Buffer.from("deposit")], PSM)[0];

function initMarketIx(market: PublicKey, base: PublicKey, quote: PublicKey, creator: PublicKey) {
  const data = Buffer.concat([Buffer.from([100]), u64(512), u64(512), u64(1153), u64(1_000_000), u64(10_000), u64(1),
    Buffer.from([0, 0]), creator.toBuffer(), Buffer.from([0])]);
  return new TransactionInstruction({ programId: PHX, data, keys: [
    { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
    { pubkey: market, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: base, isSigner: false, isWritable: false }, { pubkey: quote, isSigner: false, isWritable: false },
    { pubkey: vault(market, base), isSigner: false, isWritable: true }, { pubkey: vault(market, quote), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
}
const phxAuthIx = (code: number, payload: Buffer, market: PublicKey, authority: PublicKey, w: boolean) => new TransactionInstruction({
  programId: PHX, data: Buffer.concat([Buffer.from([code]), payload]), keys: [
    { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
    { pubkey: market, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: w }] });
const psmClaimMarketAuthorityIx = (market: PublicKey, payer: PublicKey) => new TransactionInstruction({ programId: PSM, data: Buffer.from([0]), keys: [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
  { pubkey: market, isSigner: false, isWritable: true }, { pubkey: seatManagerAddress(market), isSigner: false, isWritable: true },
  { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: depositCollector(market), isSigner: false, isWritable: false },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });

describe("localnet PSM: handoff + ChangeMarketStatus(Paused) on a real Phoenix book", function () {
  this.timeout(120_000);
  let conn: Connection;
  const payer = Keypair.generate(); // stands in for the box upgrade key (initial SM authority)
  const pauser = Keypair.generate();
  const marketKp = Keypair.generate();
  const market = marketKp.publicKey;

  before(async function () {
    if (!RPC) return this.skip();
    conn = new Connection(RPC, "confirmed");
    for (const k of [payer, pauser]) {
      const sig = await conn.requestAirdrop(k.publicKey, (k === payer ? 10 : 1) * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
    }
    const base = await createMint(conn, payer, payer.publicKey, null, 6);
    const quote = await createMint(conn, payer, payer.publicKey, null, 6);
    const lamports = await conn.getMinimumBalanceForRentExemption(MARKET_SPACE);
    await sendAndConfirmTransaction(conn, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: market, lamports, space: MARKET_SPACE, programId: PHX }),
      initMarketIx(market, base, quote, payer.publicKey)), [payer, marketKp]);
    await sendAndConfirmTransaction(conn, new Transaction().add(
      phxAuthIx(103, Buffer.from([1]), market, payer.publicKey, true),
      phxAuthIx(102, seatManagerAddress(market).toBuffer(), market, payer.publicKey, false),
      psmClaimMarketAuthorityIx(market, payer.publicKey)), [payer]);
  });

  const status = async () => decodePhoenixMarketStatus((await conn.getAccountInfo(market, { commitment: "confirmed", dataSlice: { offset: 0, length: 16 } }))!.data);
  const smAuthority = async () => decodeSeatManager((await conn.getAccountInfo(seatManagerAddress(market), "confirmed"))!.data).authority;

  it("bootstrap state: book Active, seat-manager authority = payer (upgrade key stand-in)", async () => {
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
    expect((await smAuthority()).toBase58()).to.equal(payer.publicKey.toBase58());
  });

  it("before the handoff the pauser can't pause (Signer key check)", async () => {
    let err: unknown = null;
    try {
      await sendAndConfirmTransaction(conn, new Transaction().add(psmChangeMarketStatusIx({ market, authority: pauser.publicKey, status: PhoenixMarketStatus.Paused })), [pauser]);
    } catch (e) { err = e; }
    expect(err, "pauser must be refused before the handoff").to.not.equal(null);
    expect(String(err)).to.not.match(/privilege escalated/); // refused by the SM authority check, not account metas
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
  });

  it("handoff (NameSuccessor + ClaimSeatManagerAuthority in one tx) → pauser is the SM authority", async () => {
    const tx = new Transaction().add(...seatManagerHandoffIxs({ market, currentAuthority: payer.publicKey, newAuthority: pauser.publicKey }));
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, tx, [payer, pauser]);
    expect((await smAuthority()).toBase58()).to.equal(pauser.publicKey.toBase58());
  });

  it("the old authority (upgrade key) can no longer change the status", async () => {
    let err: unknown = null;
    try {
      await sendAndConfirmTransaction(conn, new Transaction().add(psmChangeMarketStatusIx({ market, authority: payer.publicKey, status: PhoenixMarketStatus.PostOnly })), [payer]);
    } catch (e) { err = e; }
    expect(err).to.not.equal(null);
    expect(String(err)).to.not.match(/privilege escalated/);
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
  });

  it("runPausePass at expiry pauses the book (Paused = cancel/withdraw only); a second pass is a no-op", async () => {
    const book = { strikeMarket: Keypair.generate().publicKey, phoenixMarket: market, expiryTs: Math.floor(Date.now() / 1000) - 1, label: "localnet" };
    const deps = { ...livePauseDeps({ connection: conn, program: undefined as any, pauser }), listBooks: async () => [book], log: () => {} };
    const r1 = await runPausePass(deps, pauser.publicKey, {});
    expect(r1.paused).to.have.length(1);
    expect(await status()).to.equal(PhoenixMarketStatus.Paused);
    const r2 = await runPausePass(deps, pauser.publicKey, {});
    expect(r2.paused).to.have.length(0);
    expect(r2.decisions[0].action).to.equal("done");
  });

  it("the pauser can resume (Paused → Active) for ops recovery", async () => {
    await sendAndConfirmTransaction(conn, new Transaction().add(psmChangeMarketStatusIx({ market, authority: pauser.publicKey, status: PhoenixMarketStatus.Active })), [pauser]);
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
  });
});
