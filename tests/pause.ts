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

describe("pause + lifecycle P0 (TEST_MATRIX Cluster F)", () => {
  before(() => assertIdlHasInstructions("pause-suite"));

  it("X-01: after pause, mint and create_strike_market fail with Paused", async () => {
    const ctx = await TestCtx.boot();
    expect(PAUSE_BLOCKS).to.include("mint");
    expect(PAUSE_BLOCKS).to.include("create_strike_market");
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.pause();
    await expectErr(ctx.mint(ONE), "Paused");
    // second market create should also fail paused
    ctx.equity = Buffer.from("MSFT    ");
    await expectErr(
      ctx.createMarket({ expiryTs: ctx.clockUnix + 5000 }),
      "Paused"
    );
  });

  it("X-02: while paused, settle then redeem still succeed (I5)", async () => {
    const ctx = await TestCtx.boot();
    expect(PAUSE_ALLOWS).to.include("settle");
    expect(PAUSE_ALLOWS).to.include("redeem");
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.pause();
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 18_100_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
    await ctx.settle();
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "yes");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, "X-02");
  });

  it("X-04: e2e fee=0 SettledYes — create → mint → warp expiry → settle ≥strike → redeem Yes", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.setPhoenix();
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 18_100_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
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
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 17_900_000_000n });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 17_900_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
    await ctx.settle();
    await ctx.redeem(ONE, "no");
    const inv = await ctx.invariantCtx();
    expect(inv.pairsRedeemed.eq(ONE)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("X-06: mint → settle → second settle fails (I4)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 18_100_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
    await ctx.settle();
    await expectErr(ctx.settle(), "MarketNotOpen");
  });
});
