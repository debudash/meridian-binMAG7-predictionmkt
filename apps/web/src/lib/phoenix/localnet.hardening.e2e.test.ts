/**
 * LOCALNET-ONLY hardening E2E (opt-in; skipped unless LOCALNET_E2E=1).
 * Real Phoenix V1 + Meridian on a *separate* solana-test-validator (never Debu's :8899 play chain).
 * Orders go through the exact UI path (fetchMarketViaRpc → placePhoenixOrder); lifecycle steps use
 * the localnet IDL fixtures (sim_close / SimClock warp / upsert_mock_pyth) + automation's settle.
 *
 *   LOCALNET_E2E=1 E2E_RPC=http://127.0.0.1:8799 E2E_STATE=/abs/state.json \
 *   E2E_TRADER_A=/abs/trader-a.json E2E_TRADER_B=/abs/maker.json \
 *   E2E_IDL=/abs/target/idl/meridian.json npx vitest run src/lib/phoenix/localnet.hardening.e2e.test.ts
 *
 * State comes from scripts/bootstrap-localnet-play.ts + seed-phoenix + scripts/e2e/create-lifecycle-markets.ts.
 * Invariants after every step: vault USDC == outstanding pairs × $1; Yes supply == No supply until settle.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import type { Intent } from "@/lib/intents/types";

const RUN = process.env.LOCALNET_E2E === "1" && !!process.env.E2E_STATE;
const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:8799";
const ONE = 1_000_000;
const STATUS = { Open: 0, SettledYes: 2, SettledNo: 3 } as const;

const kpFrom = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const r2 = (x: number) => Math.round(x * 100) / 100;
const log = (o: unknown) => console.log(JSON.stringify(o));

describe.skipIf(!RUN)("localnet hardening E2E (real Phoenix)", () => {
  let conn: Connection;
  let state: any;
  let A: Keypair, B: Keypair, AUTH: Keypair;
  let fixtures: Program; // localnet IDL (authority)
  let lib: {
    fetchMarketViaRpc: typeof import("@/lib/indexer/rpc").fetchMarketViaRpc;
    placePhoenixOrder: typeof import("@/lib/phoenix/client").placePhoenixOrder;
    fetchPhoenixBook: typeof import("@/lib/phoenix/client").fetchPhoenixBook;
    loadPhoenixClient: typeof import("@/lib/phoenix/client").loadPhoenixClient;
    getMeridianProgram: typeof import("@/lib/solana/program").getMeridianProgram;
    getIntentAvailability: typeof import("@/lib/intents/getIntentAvailability").getIntentAvailability;
    settleMarket: (o: { program: Program; settler: Keypair; market: PublicKey; pythPriceFeed: PublicKey; simClock?: PublicKey | null }) => Promise<string>;
  };
  const checks: string[] = [];

  beforeAll(async () => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error("localnet only");
    state = JSON.parse(fs.readFileSync(process.env.E2E_STATE!, "utf8"));
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = RPC;
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    process.env.NEXT_PUBLIC_MERIDIAN_PROGRAM_ID = state.programId;
    process.env.NEXT_PUBLIC_USDC_MINT = state.usdcMint;
    process.env.NEXT_PUBLIC_PHOENIX_ENABLED = "true";
    conn = new Connection(RPC, "confirmed");
    A = kpFrom(process.env.E2E_TRADER_A!);
    B = kpFrom(process.env.E2E_TRADER_B!);
    AUTH = kpFrom(process.env.E2E_AUTHORITY ?? `${process.env.HOME}/.config/solana/id.json`);
    const idl = JSON.parse(fs.readFileSync(process.env.E2E_IDL!, "utf8")) as Idl;
    fixtures = new Program(idl, new AnchorProvider(conn, new Wallet(AUTH), { commitment: "confirmed" }));
    const rpc = await import("@/lib/indexer/rpc");
    const phx = await import("@/lib/phoenix/client");
    const prog = await import("@/lib/solana/program");
    const avail = await import("@/lib/intents/getIntentAvailability");
    // automation's settle (same accounts the sim worker sends). Non-literal path on purpose:
    // web `tsc`/`next build` must not resolve apps/automation (its deps aren't installed there).
    const AUTO = "../../../../automation/src/solana/instructions";
    const auto: { settleMarket: unknown } = await import(/* @vite-ignore */ AUTO);
    lib = {
      fetchMarketViaRpc: rpc.fetchMarketViaRpc,
      placePhoenixOrder: phx.placePhoenixOrder,
      fetchPhoenixBook: phx.fetchPhoenixBook,
      loadPhoenixClient: phx.loadPhoenixClient,
      getMeridianProgram: prog.getMeridianProgram,
      getIntentAvailability: avail.getIntentAvailability,
      settleMarket: auto.settleMarket as any,
    };
  }, 60_000);

  async function bal(mint: string, owner: PublicKey) {
    try {
      return (await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), owner), "confirmed")).value.uiAmount ?? 0;
    } catch {
      return 0;
    }
  }
  async function balances(kp: Keypair, idx: number) {
    const m = state.markets[idx];
    return { usdc: await bal(state.usdcMint, kp.publicKey), yes: await bal(m.yesMint, kp.publicKey), no: await bal(m.noMint, kp.publicKey) };
  }

  /** I2/I3: vault == outstanding pairs × $1 (fees 0); Yes supply == No supply while Open. */
  async function invariants(idx: number, step: string) {
    const m = state.markets[idx];
    const sm: any = await (fixtures.account as any).strikeMarket.fetch(new PublicKey(m.market));
    const vault = BigInt((await conn.getTokenAccountBalance(sm.collateralVault, "confirmed")).value.amount);
    const yes = (await getMint(conn, new PublicKey(m.yesMint))).supply;
    const no = (await getMint(conn, new PublicKey(m.noMint))).supply;
    const outstanding = BigInt(sm.pairsMinted.toString()) - BigInt(sm.pairsRedeemed.toString());
    const status = Number(sm.status);
    const row = { step, market: `${m.symbol} ${m.strikeE6 / 1e6}`, status, vault: vault.toString(), outstanding: outstanding.toString(), yes: yes.toString(), no: no.toString() };
    expect(vault, `${step}: vault == outstanding pairs`).toBe(outstanding);
    if (status === STATUS.Open) {
      expect(yes, `${step}: yes supply == no supply`).toBe(no);
      expect(yes, `${step}: supply == outstanding`).toBe(outstanding);
    } else {
      const winning = status === STATUS.SettledYes ? yes : no;
      expect(winning <= vault, `${step}: winning supply covered by vault`).toBe(true);
    }
    checks.push(step);
    return row;
  }

  async function sendAs(kp: Keypair, ixs: TransactionInstruction[]) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async function place(
    kp: Keypair,
    idx: number,
    intent: Intent,
    size: number,
    opts: { orderType?: "market" | "limit"; price?: number; worst?: number } = {},
  ) {
    const m = state.markets[idx];
    const market = (await lib.fetchMarketViaRpc(m.market, RPC))!;
    expect(market.phoenixMarket).toBe(m.phoenixMarket);
    const touch = { "buy-yes": market.yesAsk!, "sell-yes": market.yesBid!, "buy-no": r2(1 - market.yesBid!), "sell-no": r2(1 - market.yesAsk!) }[intent];
    const price = opts.price ?? touch;
    const isBuy = intent.startsWith("buy");
    const orderType = opts.orderType ?? "market";
    const worst = opts.worst ?? (orderType === "market" ? (isBuy ? r2(price + 0.02) : r2(price - 0.02)) : undefined);
    const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
    const before = await balances(kp, idx);
    const res = await lib.placePhoenixOrder(
      { phoenixMarket: market.phoenixMarket!, intent, price, size, orderType, tickSize: market.tickSize, worstPrice: worst, strikeMarket: market.marketId, yesMint: market.yesMint, noMint: market.noMint },
      {
        connection: conn,
        publicKey: kp.publicKey,
        sendTransaction: async (tx: Transaction, c: Connection) => {
          tx.partialSign(kp);
          const sig = await c.sendRawTransaction(tx.serialize());
          await c.confirmTransaction(sig, "confirmed");
          const st = await c.getSignatureStatus(sig);
          if (st.value?.err) throw new Error("tx failed " + JSON.stringify(st.value.err));
          return sig;
        },
        program: lib.getMeridianProgram(provider),
        mintAccounts: {
          user: kp.publicKey,
          strikeMarket: new PublicKey(market.marketId),
          collateralVault: new PublicKey(market.collateralVault!),
          yesMint: new PublicKey(market.yesMint!),
          noMint: new PublicKey(market.noMint!),
          treasury: new PublicKey(market.treasury!),
          collateralMint: new PublicKey(state.usdcMint),
        },
        ensureSeat: true,
      },
    );
    const after = await balances(kp, idx);
    const d = { usdc: r2(after.usdc - before.usdc), yes: r2(after.yes - before.yes), no: r2(after.no - before.no) };
    log({ intent, orderType, size, price, worst, market: `${m.symbol} ${m.strikeE6 / 1e6}`, ok: res.ok, msg: res.message?.slice(0, 160), d });
    return { res, before, after, d, market };
  }

  async function phoenixTrader(idx: number, trader: PublicKey) {
    const { client } = await lib.loadPhoenixClient(conn, [new PublicKey(state.markets[idx].phoenixMarket)]);
    const ms: any = client.marketStates.get(state.markets[idx].phoenixMarket);
    const ts = ms.data.traders.get(trader.toBase58());
    return { ms, ts: ts ? { quoteFree: Number(ts.quoteLotsFree), quoteLocked: Number(ts.quoteLotsLocked), baseFree: Number(ts.baseLotsFree), baseLocked: Number(ts.baseLotsLocked) } : null };
  }

  function availability(yesQty: number, noQty: number, openBuyYes = 0, openBuyNo = 0) {
    return lib.getIntentAvailability(
      { yesQty, noQty },
      { openBuyYesQty: openBuyYes, openBuyNoQty: openBuyNo },
      { pendingTradeCount: 0 },
      { lifecycle: "open", lotSize: 1 } as any,
    );
  }

  // ---------- 1. Market orders: Buy/Sell × Yes/No ----------
  it("market: Buy Yes / Sell Yes / Buy No / Sell No fill and keep invariants", async () => {
    await invariants(0, "M0 baseline AAPL230");
    let r = await place(A, 0, "buy-yes", 10);
    expect(r.res.ok).toBe(true);
    expect(r.d.yes).toBe(10);
    expect(r.d.usdc).toBeLessThan(0);
    await invariants(0, "M1 buy-yes");
    r = await place(A, 0, "sell-yes", 10);
    expect(r.res.ok).toBe(true);
    expect(r.d.yes).toBe(-10);
    expect(r.d.usdc).toBeGreaterThan(0);
    await invariants(0, "M2 sell-yes");
    await invariants(1, "M3 baseline AAPL225");
    r = await place(A, 1, "buy-no", 10);
    expect(r.res.ok).toBe(true);
    expect(r.d.no).toBe(10);
    expect(r.d.yes).toBe(0);
    await invariants(1, "M4 buy-no (mint + ask Yes)");
    r = await place(A, 1, "sell-no", 10);
    expect(r.res.ok).toBe(true);
    expect(r.d.no).toBe(-10);
    expect(r.d.yes).toBe(0);
    expect(r.d.usdc).toBeGreaterThan(0);
    await invariants(1, "M5 sell-no (bid Yes + merge_pair)");
  }, 180_000);

  // ---------- 2. Limit orders: resting, partial fill by 2nd wallet, cancel ----------
  it("limit Buy Yes rests, is partially filled by a second wallet, remainder cancels", async () => {
    const idx = 2; // NVDA 140
    const m0 = (await lib.fetchMarketViaRpc(state.markets[idx].market, RPC))!;
    const px = r2(m0.yesBid! + 0.01);
    expect(px).toBeLessThan(m0.yesAsk!);
    const r = await place(A, idx, "buy-yes", 10, { orderType: "limit", price: px });
    expect(r.res.ok).toBe(true);
    expect(r.d.yes).toBe(0); // nothing crossed
    const book = await lib.fetchPhoenixBook(state.markets[idx].phoenixMarket, conn);
    expect(book!.bids[0]).toMatchObject({ price: px, size: 10 });
    let t = await phoenixTrader(idx, A.publicKey);
    log({ step: "L1 resting", trader: t.ts });
    await invariants(idx, "L1 limit buy-yes resting");

    // second wallet (maker B) sells 4 Yes into A's bid (IOC ask at px)
    const rb = await place(B, idx, "sell-yes", 4, { price: px, worst: px });
    expect(rb.res.ok).toBe(true);
    expect(rb.d.yes).toBe(-4);
    const afterFill = await balances(A, idx);
    t = await phoenixTrader(idx, A.publicKey);
    log({ step: "L2 partial fill", walletYesDelta: r2(afterFill.yes - r.after.yes), trader: t.ts });
    // Phoenix credits maker fills to the seat (baseLotsFree), NOT the wallet ATA.
    expect(t.ts!.baseFree).toBe(4);
    expect(afterFill.yes - r.after.yes).toBe(0);
    const avail = availability(afterFill.yes, afterFill.no);
    log({ step: "L2b UI availability with Yes stuck in seat", buyNo: avail["buy-no"].enabled, sellYes: avail["sell-yes"].enabled });
    await invariants(idx, "L2 partial fill");

    // cancel remainder (Phoenix CancelAllOrders returns locked quote) + withdraw free funds
    const ms = t.ms;
    await sendAs(A, [ms.createCancelAllOrdersInstruction(A.publicKey)]);
    t = await phoenixTrader(idx, A.publicKey);
    const book2 = await lib.fetchPhoenixBook(state.markets[idx].phoenixMarket, conn);
    expect(book2!.bids.find((l) => l.price === px)).toBeUndefined();
    log({ step: "L3 cancelled", trader: t.ts });
    await sendAs(A, [ms.createWithdrawFundsInstruction({ withdrawFundsParams: { quoteLotsToWithdraw: null, baseLotsToWithdraw: null } }, A.publicKey)]);
    const fin = await balances(A, idx);
    t = await phoenixTrader(idx, A.publicKey);
    log({ step: "L4 withdrawn", d: { usdc: r2(fin.usdc - r.before.usdc), yes: r2(fin.yes - r.before.yes) }, trader: t.ts });
    expect(r2(fin.yes - r.before.yes)).toBe(4);
    expect(r2(fin.usdc - r.before.usdc)).toBe(r2(-4 * px));
    await invariants(idx, "L4 cancel + withdraw");
  }, 180_000);

  it("limit Sell Yes that crosses fills immediately (taker) and lands in the wallet", async () => {
    const idx = 3; // MSFT 420
    const buy = await place(A, idx, "buy-yes", 6);
    expect(buy.res.ok).toBe(true);
    const m0 = (await lib.fetchMarketViaRpc(state.markets[idx].market, RPC))!;
    const r = await place(A, idx, "sell-yes", 6, { orderType: "limit", price: m0.yesBid! });
    expect(r.res.ok).toBe(true);
    const t = await phoenixTrader(idx, A.publicKey);
    log({ step: "L5 crossing limit sell", d: r.d, trader: t.ts });
    expect(r.d.yes).toBe(-6);
    await invariants(idx, "L5 crossing limit sell-yes");
  }, 120_000);

  // ---------- 3. Blocks / failures ----------
  it("opposite-side block: UI gate blocks Buy No while holding Yes (program does not)", async () => {
    const idx = 0;
    const r = await place(A, idx, "buy-yes", 5);
    expect(r.res.ok).toBe(true);
    const av = availability(r.after.yes, r.after.no);
    expect(av["buy-no"].enabled).toBe(false);
    expect(av["sell-yes"].enabled).toBe(true);
    log({ step: "B1 availability holding Yes", buyNo: av["buy-no"] });
    // unwind
    const s = await place(A, idx, "sell-yes", 5);
    expect(s.res.ok).toBe(true);
    await invariants(idx, "B1 block check + unwind");
  }, 120_000);

  it("slippage: market Buy Yes with worst below the ask → no fill, no funds moved", async () => {
    const idx = 4; // TSLA 250
    const m0 = (await lib.fetchMarketViaRpc(state.markets[idx].market, RPC))!;
    const r = await place(A, idx, "buy-yes", 10, { price: m0.yesAsk!, worst: r2(m0.yesAsk! - 0.03) });
    log({ step: "F1", ok: r.res.ok, reason: r.res.reason, msg: r.res.message, d: r.d });
    expect(r.res.ok, "no silent 0-fill success (D-024)").toBe(false);
    expect(r.res.reason).toBe("no-fill");
    expect(r.d.yes).toBe(0);
    expect(r.d.usdc).toBe(0);
    await invariants(idx, "F1 slippage no-fill buy-yes");
  }, 120_000);

  it("slippage: market Sell No when bid cannot fill → whole tx reverts (merge needs Yes)", async () => {
    const idx = 4;
    const bn = await place(A, idx, "buy-no", 5);
    expect(bn.res.ok).toBe(true);
    const m0 = (await lib.fetchMarketViaRpc(state.markets[idx].market, RPC))!;
    const noPx = r2(1 - m0.yesAsk!);
    const r = await place(A, idx, "sell-no", 5, { price: noPx, worst: r2(noPx + 0.05) });
    log({ step: "F2", ok: r.res.ok, msg: r.res.message?.slice(0, 200), d: r.d });
    expect(r.res.ok).toBe(false);
    expect(r.res.reason).toBe("no-fill");
    expect(r.d).toEqual({ usdc: 0, yes: 0, no: 0 });
    await invariants(idx, "F2 sell-no no-fill reverted");
    const s = await place(A, idx, "sell-no", 5);
    expect(s.res.ok).toBe(true);
    await invariants(idx, "F2b sell-no unwind");
  }, 120_000);

  it("DLV-070: market Buy No that can't fully fill reverts the mint too (fill-or-kill, D-024)", async () => {
    const idx = 5; // META 580
    const m0 = (await lib.fetchMarketViaRpc(state.markets[idx].market, RPC))!;
    // Buy No at a No price whose Yes-ask floor is above every bid → IOC ask fills 0
    const noPx = r2(1 - m0.yesBid!);
    const r = await place(A, idx, "buy-no", 7, { price: noPx, worst: r2(noPx - 0.05) });
    log({ step: "F3 DLV-070", ok: r.res.ok, reason: r.res.reason, msg: r.res.message, d: r.d });
    expect(r.res.ok).toBe(false);
    expect(r.res.reason).toBe("no-fill");
    expect(r.d, "no stray Yes+No, no USDC spent").toEqual({ usdc: 0, yes: 0, no: 0 });
    await invariants(idx, "F3 buy-no no-fill reverted");
  }, 120_000);

  // ---------- 4. Lifecycle: open → trade → close → warp → settle (automation) → redeem ----------
  async function lifecycle(idx: number, settlePriceE8: bigint, expectStatus: number, tag: string) {
    const m = state.markets[idx];
    const marketPk = new PublicKey(m.market);
    // trade: A buys Yes, B (maker) holds the No side of minted pairs
    const by = await place(A, idx, "buy-yes", 8);
    expect(by.res.ok).toBe(true);
    const bn = await place(A, idx, "sell-yes", 3);
    expect(bn.res.ok).toBe(true);
    await invariants(idx, `${tag} traded`);

    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], fixtures.programId);
    const [simClock] = PublicKey.findProgramAddressSync([Buffer.from("sim_clock")], fixtures.programId);
    await (fixtures.methods as any).simCloseSession().accounts({ authority: AUTH.publicKey, config, strikeMarket: marketPk }).rpc();
    if (!(await conn.getAccountInfo(simClock))) {
      await (fixtures.methods as any).initSimClock().accounts({ authority: AUTH.publicKey, config, simClock, systemProgram: SystemProgram.programId }).rpc();
    }
    const slot = await conn.getSlot("confirmed");
    const now = Math.floor(Date.now() / 1000);
    await (fixtures.methods as any).setSimClock(new BN(now), new BN(slot)).accounts({ authority: AUTH.publicKey, config, simClock }).rpc();
    await (fixtures.methods as any).warpSimClock(new BN(m.expiryTs - now + 5), new BN(10)).accounts({ authority: AUTH.publicKey, config, simClock }).rpc();
    const sim: any = await (fixtures.account as any).simClock.fetch(simClock);
    const feed = kpFrom(m.pythKeypairPath);
    await (fixtures.methods as any)
      .upsertMockPyth({ price: new BN(settlePriceE8.toString()), conf: new BN(1000), expo: -8, publishSlot: new BN(sim.slot.toString()), feedId: Array.from(Buffer.from(m.feedIdHex, "hex")) })
      .accounts({ payer: AUTH.publicKey, pythPriceFeed: feed.publicKey, systemProgram: SystemProgram.programId })
      .signers([AUTH, feed])
      .rpc();

    // automation settle as shipped (no simClock) — expected to be refused before wall expiry
    let autoErr: string | null = null;
    try {
      await lib.settleMarket({ program: fixtures, settler: AUTH, market: marketPk, pythPriceFeed: feed.publicKey });
    } catch (e) {
      autoErr = String((e as Error).message).slice(0, 160);
    }
    log({ step: `${tag} automation settle without simClock`, autoErr });
    if (autoErr) {
      await lib.settleMarket({ program: fixtures, settler: AUTH, market: marketPk, pythPriceFeed: feed.publicKey, simClock });
    }
    const sm: any = await (fixtures.account as any).strikeMarket.fetch(marketPk);
    log({ step: `${tag} settled`, status: Number(sm.status), price: sm.settlementPriceE6.toString(), strike: sm.strikePriceE6.toString() });
    expect(Number(sm.status)).toBe(expectStatus);
    await invariants(idx, `${tag} settled`);

    // mint after settle must fail
    const late = await place(A, idx, "buy-no", 1);
    expect(late.res.ok).toBe(false);
    expect(late.res.reason).toBe("program-error");

    // redeem winner, loser pays 0
    const winYes = expectStatus === STATUS.SettledYes;
    for (const kp of [A, B]) {
      const b = await balances(kp, idx);
      const win = winYes ? b.yes : b.no;
      const lose = winYes ? b.no : b.yes;
      const winMint = new PublicKey(winYes ? m.yesMint : m.noMint);
      const loseMint = new PublicKey(winYes ? m.noMint : m.yesMint);
      const user = new Program(fixtures.idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
      const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), marketPk.toBuffer()], fixtures.programId);
      if (win > 0) {
        await (user.methods as any).redeem(new BN(Math.round(win * ONE))).accounts({
          user: kp.publicKey, config, strikeMarket: marketPk, collateralVault: sm.collateralVault, vaultAuthority,
          userCollateralAta: getAssociatedTokenAddressSync(new PublicKey(state.usdcMint), kp.publicKey),
          userWinningAta: getAssociatedTokenAddressSync(winMint, kp.publicKey), winningMint: winMint, treasury: new PublicKey(state.treasury), tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      }
      if (lose > 0) {
        // loser redeem attempt must fail; burn_losing pays 0
        let loserErr = "";
        try {
          await (user.methods as any).redeem(new BN(Math.round(lose * ONE))).accounts({
            user: kp.publicKey, config, strikeMarket: marketPk, collateralVault: sm.collateralVault, vaultAuthority,
            userCollateralAta: getAssociatedTokenAddressSync(new PublicKey(state.usdcMint), kp.publicKey),
            userWinningAta: getAssociatedTokenAddressSync(loseMint, kp.publicKey), winningMint: loseMint, treasury: new PublicKey(state.treasury), tokenProgram: TOKEN_PROGRAM_ID,
          }).rpc();
        } catch (e) {
          loserErr = String((e as Error).message).slice(0, 120);
        }
        expect(loserErr, "loser redeem must fail").not.toBe("");
        const usdcBefore = (await balances(kp, idx)).usdc;
        await (user.methods as any).burnLosing(new BN(Math.round(lose * ONE))).accounts({
          user: kp.publicKey, config, strikeMarket: marketPk, userLosingAta: getAssociatedTokenAddressSync(loseMint, kp.publicKey), losingMint: loseMint, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        expect((await balances(kp, idx)).usdc).toBe(usdcBefore);
      }
      const a = await balances(kp, idx);
      log({ step: `${tag} redeem ${kp === A ? "A" : "B"}`, win, lose, usdcDelta: r2(a.usdc - b.usdc) });
      expect(r2(a.usdc - b.usdc)).toBe(r2(win));
      await invariants(idx, `${tag} redeemed ${kp === A ? "A" : "B"}`);
    }
    return autoErr;
  }

  it("lifecycle above: settle at strike-touch (≥, D-005) → Yes wins; redeem winner, loser 0", async () => {
    const idx = state.lifecycleMarkets[0];
    const strikeE8 = BigInt(state.markets[idx].strikeE6) * 100n;
    await lifecycle(idx, strikeE8, STATUS.SettledYes, "LC-UP");
  }, 240_000);

  it("lifecycle below: settle one cent under strike → No wins; redeem winner, loser 0", async () => {
    const idx = state.lifecycleMarkets[1];
    const strikeE8 = BigInt(state.markets[idx].strikeE6) * 100n - 1_000_000n;
    await lifecycle(idx, strikeE8, STATUS.SettledNo, "LC-DN");
  }, 240_000);

  // ---------- 5. Pause + admin override ----------
  it("pause blocks new Buy No (mint) but not Phoenix-only trades; admin_settle overrides after expiry", async () => {
    const idx = state.lifecycleMarkets[2];
    const m = state.markets[idx];
    const marketPk = new PublicKey(m.market);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], fixtures.programId);
    const [simClock] = PublicKey.findProgramAddressSync([Buffer.from("sim_clock")], fixtures.programId);
    const pre = await place(A, idx, "buy-yes", 4);
    expect(pre.res.ok).toBe(true);
    await (fixtures.methods as any).pause().accounts({ authority: AUTH.publicKey, config }).rpc();
    try {
      const bn = await place(A, idx, "buy-no", 2);
      log({ step: "P1 paused buy-no", ok: bn.res.ok, msg: bn.res.message?.slice(0, 160) });
      expect(bn.res.ok).toBe(false);
      expect(bn.res.message).toMatch(/paused/i);
      const sn = await place(A, idx, "sell-no", 1);
      log({ step: "P1b paused sell-no (merge)", ok: sn.res.ok });
      expect(sn.res.ok).toBe(false); // merge_pair is pause-gated (MP pin)
      const sy = await place(A, idx, "sell-yes", 2);
      log({ step: "P2 paused sell-yes (Phoenix only)", ok: sy.res.ok });
      await invariants(idx, "P2 paused");
    } finally {
      await (fixtures.methods as any).unpause().accounts({ authority: AUTH.publicKey, config }).rpc();
    }
    // admin override: close session, warp past expiry (+delay 0), admin_settle Yes at strike
    await (fixtures.methods as any).simCloseSession().accounts({ authority: AUTH.publicKey, config, strikeMarket: marketPk }).rpc();
    const sim0: any = await (fixtures.account as any).simClock.fetch(simClock);
    const add = m.expiryTs - Number(sim0.unixTimestamp.toString()) + 5;
    if (add > 0) await (fixtures.methods as any).warpSimClock(new BN(add), new BN(10)).accounts({ authority: AUTH.publicKey, config, simClock }).rpc();
    let nonAuthErr = "";
    try {
      const rogue = new Program(fixtures.idl, new AnchorProvider(conn, new Wallet(A), { commitment: "confirmed" }));
      await (rogue.methods as any).adminSettle(new BN(m.strikeE6), true).accounts({ authority: A.publicKey, config, strikeMarket: marketPk, simClock }).rpc();
    } catch (e) {
      nonAuthErr = String((e as Error).message).slice(0, 120);
    }
    expect(nonAuthErr).not.toBe("");
    // inconsistent outcome (price < strike but outcome Yes) must be rejected (A-05)
    let incErr = "";
    try {
      await (fixtures.methods as any).adminSettle(new BN(m.strikeE6 - 10_000), true).accounts({ authority: AUTH.publicKey, config, strikeMarket: marketPk, simClock }).rpc();
    } catch (e) {
      incErr = String((e as Error).message).slice(0, 120);
    }
    expect(incErr).not.toBe("");
    await (fixtures.methods as any).adminSettle(new BN(m.strikeE6), true).accounts({ authority: AUTH.publicKey, config, strikeMarket: marketPk, simClock }).rpc();
    const sm: any = await (fixtures.account as any).strikeMarket.fetch(marketPk);
    log({ step: "P3 admin settled", status: Number(sm.status), nonAuthErr: nonAuthErr.slice(0, 60), incErr: incErr.slice(0, 60) });
    expect(Number(sm.status)).toBe(STATUS.SettledYes);
    await invariants(idx, "P3 admin settle");
    console.log("INVARIANT CHECKS PASSED:", checks.length);
  }, 240_000);
});
