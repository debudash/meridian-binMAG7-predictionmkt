/**
 * Cluster F — Pause & cross-phase lifecycle P0.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  expectErr,
  ONE,
} from "./helpers/harness";
import {
  PAUSE_ALLOWS,
  PAUSE_BLOCKS,
  assertVaultCoversLiability,
  assertBinaryPayout,
} from "./helpers/invariants";

describe("pause + lifecycle P0 (TEST_MATRIX Cluster F)", function () {
  this.timeout(180000);
  afterEach(async () => {
    try {
      const ctx = await TestCtx.boot();
      await ctx.setupProtocol();
      await ctx.unpause();
    } catch { /* ignore */ }
  });
  before(() => assertIdlHasInstructions("pause-suite"));

  it("X-01: after pause, mint and create_strike_market fail with Paused", async () => {
    const ctx = await TestCtx.boot();
    expect(PAUSE_BLOCKS).to.include("mint");
    expect(PAUSE_BLOCKS).to.include("create_strike_market");
    expect(PAUSE_BLOCKS).to.include("merge_pair");
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.pause();
    await expectErr(ctx.mint(ONE), "Paused");
    // second market create should also fail paused
    ctx.equity = Buffer.from("MSFT    ");
    await expectErr(
      ctx.createMarket({ expiryTs: Math.floor(Date.now() / 1000) + 3600 }),
      "Paused"
    );
  });

  it("X-02: while paused, settle then redeem still succeed (I5)", async () => {
    const ctx = await TestCtx.boot();
    expect(PAUSE_ALLOWS).to.include("settle");
    expect(PAUSE_ALLOWS).to.include("redeem");
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: Math.floor(Date.now() / 1000) + 2, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.pause();
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "yes");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, "X-02");
  });

  it("X-04: e2e fee=0 SettledYes — create → mint → warp expiry → settle ≥strike → redeem Yes", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: Math.floor(Date.now() / 1000) + 2, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.setPhoenix();
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "yes");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, "X-04");
    const inv = await ctx.invariantCtx();
    assertVaultCoversLiability(inv, "X-04");
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("X-05: e2e SettledNo — mint → settle <strike → redeem No", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: Math.floor(Date.now() / 1000) + 2, pythPrice: 17_900_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 17_900_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    await ctx.redeem(ONE, "no");
    const inv = await ctx.invariantCtx();
    expect(inv.pairsRedeemed.eq(ONE)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("X-06: mint → settle → second settle fails (I4)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: Math.floor(Date.now() / 1000) + 2, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    await expectErr(ctx.settle(), "MarketNotOpen");
  });
});
