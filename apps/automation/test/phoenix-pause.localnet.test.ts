/**
 * Opt-in localnet proof of the pause mechanism against the real Phoenix + Seat Manager programs.
 *   solana-test-validator --rpc-port 8699 --faucet-port 9699 --reset \
 *     --bpf-program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY phoenix.so \
 *     --bpf-program PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1 seat_manager.so
 *   PHOENIX_LOCALNET_RPC=http://127.0.0.1:8699 npm test -- --grep "localnet PSM"
 * Same book setup as ops/devnet-bootstrap.cjs (InitializeMarket → Active → NameSuccessor(PSM PDA) →
 * PSM ClaimMarketAuthority), then the handoff + pause built by src/phoenix/seatManager.ts.
 * Second describe (Testers' gap on !73): a Paused book refuses new orders / crosses through the same
 * Phoenix ixs the web ticket sends, while cancel (CancelMultipleOrdersById) + WithdrawFunds — the
 * Portfolio cancel/withdraw ixs — still work.
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
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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
import { createPauseMemory, livePauseDeps, readBookStates, runPausePass } from "../src/phoenix/pauseAtExpiry";
import { authorityReport } from "../src/phoenix/handoff";

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

  it("M2 (review mr72-73): header authority = SM PDA; a book set Active again after a pass is re-paused + ALERTed on the next pass", async () => {
    const book = { strikeMarket: Keypair.generate().publicKey, phoenixMarket: market, expiryTs: Math.floor(Date.now() / 1000) - 1, label: "localnet-m2" };
    const st = (await readBookStates(conn, [book])).get(market.toBase58())!;
    expect(st.marketAuthority!.toBase58()).to.equal(seatManagerAddress(market).toBase58());
    const alerts: string[] = [];
    const deps = { ...livePauseDeps({ connection: conn, program: undefined as any, pauser }), listBooks: async () => [book], log: () => {}, alert: (m: string) => alerts.push(m) };
    const mem = createPauseMemory();
    const r1 = await runPausePass(deps, pauser.publicKey, {}, mem);
    expect(r1.paused).to.have.length(1);
    expect(alerts).to.deep.equal([]);
    await sendAndConfirmTransaction(conn, new Transaction().add(psmChangeMarketStatusIx({ market, authority: pauser.publicKey, status: PhoenixMarketStatus.Active })), [pauser]);
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
    const r2 = await runPausePass(deps, pauser.publicKey, {}, mem);
    expect(r2.paused).to.have.length(1);
    expect(await status()).to.equal(PhoenixMarketStatus.Paused);
    expect(alerts.some((a) => /went Active again after it was paused/.test(a))).to.equal(true);
  });

  it("Reviewers !78 N-2/N-5 PoC: book taken out of PSM (PSM 9 → Phoenix 101 → 103 Active) fails --expect-pauser, gets no pause send, rate-limited ALERTs", async () => {
    const attacker = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL), "confirmed");
    const psm9 = new TransactionInstruction({ programId: PSM, data: Buffer.concat([Buffer.from([9]), attacker.publicKey.toBuffer()]), keys: [
      { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true }, { pubkey: seatManagerAddress(market), isSigner: false, isWritable: true },
      { pubkey: pauser.publicKey, isSigner: true, isWritable: false }] });
    await sendAndConfirmTransaction(conn, new Transaction().add(psm9), [pauser]); // leaked pauser names the attacker
    await sendAndConfirmTransaction(conn, new Transaction().add(
      phxAuthIx(101, Buffer.alloc(0), market, attacker.publicKey, false),
      phxAuthIx(103, Buffer.from([1]), market, attacker.publicKey, true)), [attacker]);
    expect(await status()).to.equal(PhoenixMarketStatus.Active);
    const book = { strikeMarket: Keypair.generate().publicKey, phoenixMarket: market, expiryTs: Math.floor(Date.now() / 1000) - 1, label: "localnet-poc" };
    const states = await readBookStates(conn, [book]);
    expect(states.get(market.toBase58())!.seatManagerAuthority!.toBase58()).to.equal(pauser.publicKey.toBase58()); // the old gate passed N/N
    const gate = authorityReport([book], states, pauser.publicKey);
    expect(gate.ok).to.equal(false);
    expect(gate.mismatches[0].reason).to.equal("left-psm");
    const alerts: string[] = [];
    let sends = 0;
    const live = livePauseDeps({ connection: conn, program: undefined as any, pauser });
    const deps = { ...live, listBooks: async () => [book], log: () => {}, alert: (m: string) => alerts.push(m), sendPause: async (b: any) => { sends++; return live.sendPause(b); } };
    const mem = createPauseMemory();
    mem.pausedOnce.add(market.toBase58());
    for (let i = 0; i < 5; i++) {
      const r = await runPausePass(deps, pauser.publicKey, {}, mem);
      expect(r.decisions[0].action).to.equal("skip-left-psm");
    }
    expect(sends).to.equal(0);
    expect(alerts.filter((a) => /not the Seat Manager PDA/.test(a))).to.have.length(1);
    expect(alerts.filter((a) => /went Active again.*left the Seat Manager/.test(a))).to.have.length(1);
    expect(alerts.length).to.equal(2);
  });
});

// ── Paused book = cancel / withdraw only (Testers' gap on !73) ─────────────────────────────────
// Phoenix ix codes (phoenix-v1 src/program/instruction.rs) and Borsh layouts (order_packet.rs,
// deposit/withdraw/cancel params). Market params above: 1 base lot = 1 contract (1e6 atoms),
// 1 quote lot = 1 USDC atom, tick = 10_000 quote lots/contract ($0.01) → price_in_ticks 60 = $0.60.
const PHX_IX = { Swap: 0, PlaceLimitOrder: 2, CancelMultipleOrdersById: 10, WithdrawFunds: 12 } as const;
const SIDE = { Bid: 0, Ask: 1 } as const;
const TICK_ATOMS = 10_000n;
const LOT_ATOMS = 1_000_000n;
const optU64 = (v: number | bigint | null) => (v == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), u64(v)]));
const u128zero = Buffer.alloc(16);
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const seatPda = (market: PublicKey, trader: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("seat"), market.toBuffer(), trader.toBuffer()], PHX)[0];
/** FIFOMarket.order_sequence_number: header 576 + _padding 256 + base_lots_per_base_unit 8 + tick 8. */
const ORDER_SEQ_OFFSET = 576 + 256 + 8 + 8;

/** OrderPacket::PostOnly (variant 0) */
const postOnly = (side: number, ticks: number, lots: number) => Buffer.concat([Buffer.from([0, side]), u64(ticks), u64(lots), u128zero,
  Buffer.from([1 /* reject_post_only */, 0 /* use_only_deposited_funds */]), optU64(null), optU64(null), Buffer.from([0])]);
/** OrderPacket::Limit (variant 1) — the ticket's limit path */
const limit = (side: number, ticks: number, lots: number) => Buffer.concat([Buffer.from([1, side]), u64(ticks), u64(lots),
  Buffer.from([0 /* SelfTradeBehavior::Abort */]), optU64(null), u128zero, Buffer.from([0]), optU64(null), optU64(null), Buffer.from([0])]);
/** OrderPacket::ImmediateOrCancel (variant 2), fill-or-kill on base lots — the ticket's market path (Swap) */
const fok = (side: number, ticks: number, lots: number) => Buffer.concat([Buffer.from([2, side]), optU64(ticks), u64(lots), u64(0), u64(lots), u64(0),
  Buffer.from([0]), optU64(null), u128zero, Buffer.from([0]), optU64(null), optU64(null)]);

interface Book { market: PublicKey; base: PublicKey; quote: PublicKey }
interface Trader { kp: Keypair; baseAta: PublicKey; quoteAta: PublicKey }
const tokenIxKeys = (b: Book, t: Trader, withSeat: boolean) => [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
  { pubkey: b.market, isSigner: false, isWritable: true }, { pubkey: t.kp.publicKey, isSigner: true, isWritable: false },
  ...(withSeat ? [{ pubkey: seatPda(b.market, t.kp.publicKey), isSigner: false, isWritable: false }] : []),
  { pubkey: t.baseAta, isSigner: false, isWritable: true }, { pubkey: t.quoteAta, isSigner: false, isWritable: true },
  { pubkey: vault(b.market, b.base), isSigner: false, isWritable: true }, { pubkey: vault(b.market, b.quote), isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }];
const placeLimitIx = (b: Book, t: Trader, packet: Buffer) =>
  new TransactionInstruction({ programId: PHX, data: Buffer.concat([Buffer.from([PHX_IX.PlaceLimitOrder]), packet]), keys: tokenIxKeys(b, t, true) });
const swapIx = (b: Book, t: Trader, packet: Buffer) =>
  new TransactionInstruction({ programId: PHX, data: Buffer.concat([Buffer.from([PHX_IX.Swap]), packet]), keys: tokenIxKeys(b, t, false) });
const cancelByIdIx = (b: Book, t: Trader, orders: { side: number; ticks: number; seq: bigint }[]) =>
  new TransactionInstruction({ programId: PHX, keys: tokenIxKeys(b, t, false), data: Buffer.concat([Buffer.from([PHX_IX.CancelMultipleOrdersById]),
    u32(orders.length), ...orders.map((o) => Buffer.concat([Buffer.from([o.side]), u64(o.ticks), u64(o.seq)]))]) });
/** WithdrawFunds(all): quote None, base None (no seat account, unlike DepositFunds) */
const withdrawAllIx = (b: Book, t: Trader) =>
  new TransactionInstruction({ programId: PHX, keys: tokenIxKeys(b, t, false), data: Buffer.from([PHX_IX.WithdrawFunds, 0, 0]) });
const psmClaimSeatIx = (market: PublicKey, trader: PublicKey) => new TransactionInstruction({ programId: PSM, data: Buffer.from([1]), keys: [
  { pubkey: PHX, isSigner: false, isWritable: false }, { pubkey: phoenixLogAuthority(), isSigner: false, isWritable: false },
  { pubkey: market, isSigner: false, isWritable: true }, { pubkey: seatManagerAddress(market), isSigner: false, isWritable: true },
  { pubkey: depositCollector(market), isSigner: false, isWritable: true }, { pubkey: trader, isSigner: true, isWritable: false },
  { pubkey: trader, isSigner: true, isWritable: true }, { pubkey: seatPda(market, trader), isSigner: false, isWritable: true },
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });

describe("localnet Phoenix: Paused book refuses new orders, still allows cancel + withdraw (!73 gap)", function () {
  this.timeout(180_000);
  let conn: Connection;
  const payer = Keypair.generate();
  const pauser = Keypair.generate();
  const marketKp = Keypair.generate();
  let book: Book;
  let maker: Trader;
  let taker: Trader;
  // maker's resting orders (ids read from FIFOMarket.order_sequence_number before each place; bids store !seq)
  const resting: { side: number; ticks: number; seq: bigint }[] = [];

  const send = (ixs: TransactionInstruction[], signers: Keypair[]) =>
    sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  /** Expect a refusal; returns message + program logs for the error-copy assertions. */
  async function refused(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    try {
      await send(ixs, signers);
    } catch (e) {
      const logs: string[] = (e as { logs?: string[] }).logs ?? (await (e as { getLogs?: (c: Connection) => Promise<string[]> }).getLogs?.(conn).catch(() => [])) ?? [];
      return `${String((e as Error).message ?? e)}\n${logs.join("\n")}`;
    }
    throw new Error("expected Phoenix to refuse the order on a Paused book");
  }
  const bal = async (ata: PublicKey) => (await getAccount(conn, ata, "confirmed")).amount;
  const status = async () => decodePhoenixMarketStatus((await conn.getAccountInfo(book.market, { commitment: "confirmed", dataSlice: { offset: 0, length: 16 } }))!.data);
  const nextSeq = async () => (await conn.getAccountInfo(book.market, { commitment: "confirmed", dataSlice: { offset: ORDER_SEQ_OFFSET, length: 8 } }))!.data.readBigUInt64LE(0);
  async function rest(side: number, ticks: number, lots: number) {
    const seq = await nextSeq();
    await send([placeLimitIx(book, maker, postOnly(side, ticks, lots))], [maker.kp]);
    resting.push({ side, ticks, seq: side === SIDE.Bid ? ~seq & 0xffff_ffff_ffff_ffffn : seq });
  }
  const snapshot = async () => ({
    makerBase: await bal(maker.baseAta), makerQuote: await bal(maker.quoteAta),
    takerBase: await bal(taker.baseAta), takerQuote: await bal(taker.quoteAta),
    baseVault: await bal(vault(book.market, book.base)), quoteVault: await bal(vault(book.market, book.quote)),
  });

  before(async function () {
    if (!RPC) return this.skip();
    conn = new Connection(RPC, "confirmed");
    const makerKp = Keypair.generate();
    const takerKp = Keypair.generate();
    for (const [k, sol] of [[payer, 10], [pauser, 1], [makerKp, 2], [takerKp, 2]] as const) {
      await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
    }
    const base = await createMint(conn, payer, payer.publicKey, null, 6); // Yes stand-in
    const quote = await createMint(conn, payer, payer.publicKey, null, 6); // USDC stand-in
    const market = marketKp.publicKey;
    book = { market, base, quote };
    const lamports = await conn.getMinimumBalanceForRentExemption(MARKET_SPACE);
    await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: market, lamports, space: MARKET_SPACE, programId: PHX }),
      initMarketIx(market, base, quote, payer.publicKey)], [payer, marketKp]);
    await send([phxAuthIx(103, Buffer.from([1]), market, payer.publicKey, true),
      phxAuthIx(102, seatManagerAddress(market).toBuffer(), market, payer.publicKey, false),
      psmClaimMarketAuthorityIx(market, payer.publicKey)], [payer]);
    const handoff = new Transaction().add(...seatManagerHandoffIxs({ market, currentAuthority: payer.publicKey, newAuthority: pauser.publicKey }));
    handoff.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, handoff, [payer, pauser], { commitment: "confirmed" });

    const mkTrader = async (kp: Keypair): Promise<Trader> => {
      const baseAta = await createAssociatedTokenAccount(conn, payer, base, kp.publicKey);
      const quoteAta = await createAssociatedTokenAccount(conn, payer, quote, kp.publicKey);
      await mintTo(conn, payer, base, baseAta, payer, 10n * LOT_ATOMS);
      await mintTo(conn, payer, quote, quoteAta, payer, 10_000_000n);
      await send([psmClaimSeatIx(market, kp.publicKey)], [kp]); // permissionless seat (same as the web ClaimSeat)
      return { kp, baseAta, quoteAta };
    };
    maker = await mkTrader(makerKp);
    taker = await mkTrader(takerKp);

    // Active book: maker rests an ask 2 @ 0.60 and a bid 2 @ 0.40; taker FOK-buys 1 @ 0.60 (control:
    // the same encodings work while Active, so the refusals below are the status gate, not bad ixs).
    await rest(SIDE.Ask, 60, 2);
    await rest(SIDE.Bid, 40, 2);
    await send([swapIx(book, taker, fok(SIDE.Bid, 60, 1))], [taker.kp]);
    expect(await bal(taker.baseAta)).to.equal(11n * LOT_ATOMS);
    expect(await bal(taker.quoteAta)).to.equal(10_000_000n - 60n * TICK_ATOMS);

    // Pause exactly as production does at expiry
    const due = { strikeMarket: Keypair.generate().publicKey, phoenixMarket: market, expiryTs: Math.floor(Date.now() / 1000) - 1, label: "paused-orders" };
    const deps = { ...livePauseDeps({ connection: conn, program: undefined as any, pauser }), listBooks: async () => [due], log: () => {} };
    const r = await runPausePass(deps, pauser.publicKey, {});
    expect(r.paused).to.have.length(1);
  });

  it("book is Paused with the maker's 1 ask lot + 2 bid lots still resting (vaults hold them + the maker's fill proceeds)", async () => {
    expect(await status()).to.equal(PhoenixMarketStatus.Paused);
    const s = await snapshot();
    expect(s.baseVault).to.equal(1n * LOT_ATOMS); // 1 unfilled ask lot
    expect(s.quoteVault).to.equal(2n * 40n * TICK_ATOMS + 60n * TICK_ATOMS); // bid lock 0.80 + maker's 0.60 seat proceeds
  });

  it("refuses a market (FOK Swap) buy and sell — the ticket's market path — with the Paused log the web maps", async () => {
    const before = await snapshot();
    for (const pkt of [fok(SIDE.Bid, 60, 1), fok(SIDE.Ask, 40, 1)]) {
      const err = await refused([swapIx(book, taker, pkt)], [taker.kp]);
      expect(err).to.match(/FOK and IOC orders are not allowed, market status is Paused/);
      expect(err).to.match(/invalid account data/i);
    }
    expect(await snapshot()).to.deep.equal(before);
  });

  it("refuses limit and post-only orders (crossing or not) — the ticket's limit path", async () => {
    const before = await snapshot();
    for (const [trader, pkt] of [
      [taker, limit(SIDE.Bid, 60, 1)], // would cross the resting ask
      [taker, limit(SIDE.Bid, 30, 1)], // would rest
      [taker, postOnly(SIDE.Ask, 70, 1)],
      [maker, postOnly(SIDE.Bid, 45, 1)],
    ] as const) {
      const err = await refused([placeLimitIx(book, trader, pkt)], [trader.kp]);
      expect(err).to.match(/Post only order is not allowed, market status is Paused/);
    }
    expect(await snapshot()).to.deep.equal(before);
  });

  it("allows cancel (CancelMultipleOrdersById) + WithdrawFunds(all) — the Portfolio cancel ixs — returning every locked/free atom", async () => {
    await send([cancelByIdIx(book, maker, resting), withdrawAllIx(book, maker)], [maker.kp]);
    const s = await snapshot();
    // maker: 10 − 2 (ask) + 1 (unfilled lot back) = 9 contracts; 10 − 0.80 (bid) + 0.80 + 0.60 (fill) = 10.60 USDC
    expect(s.makerBase).to.equal(9n * LOT_ATOMS);
    expect(s.makerQuote).to.equal(10_000_000n + 60n * TICK_ATOMS);
    expect(s.baseVault).to.equal(0n);
    expect(s.quoteVault).to.equal(0n);
    expect(await status()).to.equal(PhoenixMarketStatus.Paused);
  });

  it("a stand-alone WithdrawFunds on an empty seat still succeeds while Paused (withdraw-only users)", async () => {
    await send([withdrawAllIx(book, taker)], [taker.kp]);
    expect(await status()).to.equal(PhoenixMarketStatus.Paused);
  });
});
