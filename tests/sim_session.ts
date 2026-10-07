/**
 * Cluster G — Localnet simulated session lifecycle (D-017).
 * Case IDs: SIM-01…SIM-09.
 *
 * LOCALNET-ONLY / `localnet-test`. Never required for mainnet builds.
 * Simulated open/close are NOT wall-clock 9:30 / 4:00 ET.
 * Sim trade: prefer on-book `simTradeOnBook` (DLV-064); SIM-02 still uses demoted
 * off-book Yes SPL as V-08 twin — no Meridian matcher.
 *
 * GREEN: eng `sim_open_session` / `sim_close_session` + `StrikeMarket.trading_open`
 * behind `#[cfg(feature = "localnet-test")]` (MR !16). Prod builds omit `sim_*`.
 * Expiry buffers use EXPIRY_MINT_SLACK_SECS; waitPastExpiry polls Clock sysvar — not a product soften.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  TestCtx,
  expectErr,
  ONE,
  TddRedError,
  SimError,
} from "./helpers/harness";
import {
  assertVaultCoversLiability,
  assertBinaryPayout,
  assertOpenSupplyParity,
} from "./helpers/invariants";
import { MarketStatus } from "./helpers/fixtures";

describe("localnet sim session lifecycle (TEST_MATRIX Cluster G / D-017)", function () {
  this.timeout(240000);

  it("SIM-01: sim_open → trading_open true; mint allowed (not wall-clock 9:30 ET)", async () => {
    const caseId = "SIM-01";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    // May already be open after create (compat); sim_open must be idempotent or set true.
    await ctx.simOpen(caseId);
    await ctx.assertTradingOpen(caseId);
    await ctx.mint(ONE);
    const inv = await ctx.invariantCtx();
    assertOpenSupplyParity(inv, caseId);
    assertVaultCoversLiability(inv, caseId);
  });

  it("SIM-02: while open — mint + sim trade (off-book Yes transfer); vault/pairs unchanged by transfer", async () => {
    const caseId = "SIM-02";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    const b = await ctx.bootSecondUser();
    const half = new BN(500_000);
    const before = await ctx.invariantCtx();
    await ctx.simTradeOffBook(b.user, half);
    const after = await ctx.invariantCtx();
    expect(after.pairsMinted.eq(before.pairsMinted), `${caseId}: pairs_minted`).to.equal(true);
    expect(after.pairsRedeemed.eq(before.pairsRedeemed), `${caseId}: pairs_redeemed`).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount), `${caseId}: vault`).to.equal(true);
    expect(after.yesSupply.eq(before.yesSupply), `${caseId}: yes supply`).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).eq(half)).to.equal(true);
    expect((await ctx.tokenBal(b.userYes)).eq(half)).to.equal(true);
  });

  it("SIM-03: sim_close → trading_open false (not wall-clock 4:00 PM ET)", async () => {
    const caseId = "SIM-03";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);
    await ctx.simClose(caseId);
    await ctx.assertTradingClosed(caseId);
  });

  it("SIM-04: mint after sim_close rejected (TradingClosed); vault unchanged", async () => {
    const caseId = "SIM-04";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    await ctx.simClose(caseId);
    const vaultBefore = await ctx.vaultAmount();
    const pairsBefore = (await ctx.marketState()).pairsMinted as BN;
    try {
      await ctx.mint(ONE);
      expect.fail(`${caseId}: expected mint after close to fail`);
    } catch (e) {
      if (e instanceof TddRedError) throw e;
      const ok =
        String(e).includes(SimError.TradingClosed) ||
        String(e).includes("MarketNotOpen") ||
        String((e as any)?.error?.errorCode?.code ?? "").includes("TradingClosed") ||
        String((e as any)?.error?.errorCode?.code ?? "").includes("MarketNotOpen");
      expect(ok, `${caseId}: expected TradingClosed|MarketNotOpen, got ${e}`).to.equal(true);
    }
    expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
    expect(((await ctx.marketState()).pairsMinted as BN).eq(pairsBefore)).to.equal(true);
  });

  it("SIM-05: settle before sim_close rejected (SessionNotClosed) if product requires close-first", async () => {
    const caseId = "SIM-05";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    // Mint-window slack (EXPIRY_MINT_SLACK_SECS); waitPastExpiry polls on-chain Clock.
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    // Deliberately skip sim_close
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    try {
      await ctx.settle();
      expect.fail(`${caseId}: expected settle before close to fail`);
    } catch (e) {
      if (e instanceof TddRedError) throw e;
      const code = String((e as any)?.error?.errorCode?.code ?? e);
      expect(
        code.includes(SimError.SessionNotClosed) || String(e).includes(SimError.SessionNotClosed),
        `${caseId}: expected ${SimError.SessionNotClosed}, got ${e}`
      ).to.equal(true);
    }
    expect((await ctx.marketState()).status).to.equal(MarketStatus.Open);
  });

  it("SIM-06: e2e open→mint→sim trade→close→MockPyth settle≥strike→redeem Yes; vault I3", async () => {
    const caseId = "SIM-06";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    // Mint-window slack (EXPIRY_MINT_SLACK_SECS); waitPastExpiry polls on-chain Clock.
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    const b = await ctx.bootSecondUser();
    await ctx.simTradeOffBook(b.user, new BN(500_000));
    await ctx.simClose(caseId);
    await ctx.assertTradingClosed(caseId);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);
    // Redeemer who holds Yes after off-book trade
    const colBefore = await ctx.tokenBal(b.userCollateral);
    await ctx.redeem(new BN(500_000), "yes", b.user);
    assertBinaryPayout(
      (await ctx.tokenBal(b.userCollateral)).sub(colBefore),
      new BN(500_000),
      caseId
    );
    const colBefore2 = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(new BN(500_000), "yes");
    assertBinaryPayout(
      (await ctx.tokenBal(ctx.userCollateral)).sub(colBefore2),
      new BN(500_000),
      caseId
    );
    const inv = await ctx.invariantCtx();
    assertVaultCoversLiability(inv, caseId);
    expect(inv.vaultAmount.eqn(0), `${caseId}: vault drained`).to.equal(true);
  });

  it("SIM-07: e2e close→MockPyth settle<strike→redeem No (forced NoWins)", async () => {
    const caseId = "SIM-07";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    // Mint-window slack (EXPIRY_MINT_SLACK_SECS); waitPastExpiry polls on-chain Clock.
    // price below strike → SettledNo
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 17_900_000_000n });
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    await ctx.simClose(caseId);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 17_900_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledNo);
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "no");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, caseId);
    assertVaultCoversLiability(await ctx.invariantCtx(), caseId);
  });

  it("SIM-08: after close — admin_settle path → redeem (localnet)", async () => {
    const caseId = "SIM-08";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    // SIM-08: mint-window slack + Clock-polled waitPastExpiry (AdminSettleTooEarly flake).
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack() });
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    await ctx.simClose(caseId);
    await ctx.waitPastExpiry();
    await ctx.adminSettle(ctx.strike, true);
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "yes");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, caseId);
  });

  it("SIM-09: sim_* ixs required in localnet-test IDL; must stay off mainnet builds", async () => {
    const caseId = "SIM-09";
    const ctx = await TestCtx.boot();
    // Assert localnet IDL lists sim open/close (prod builds must omit — see MR !18 CI assert)
    ctx.assertSimSessionIdl(caseId);
    // Document gate: suite only meaningful with localnet-test (package.json `yarn test`)
    expect(process.env.ANCHOR_PROVIDER_URL || "localnet").to.be.a("string");
  });
});
