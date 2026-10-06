/**
 * Cluster A — Mint P0 cases (docs/TEST_MATRIX.md).
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
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";

describe("mint P0 (TEST_MATRIX Cluster A)", () => {
  before(() => assertIdlHasInstructions("mint-suite"));

  it("M-01: mint(1e6) locks USDC and mints equal Yes/No; vault += amount; pairs_minted += amount", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    const beforeCol = await ctx.tokenBal(ctx.userCollateral);
    await ctx.mint(ONE);
    expect((await ctx.tokenBal(ctx.userYes)).eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userNo)).eq(ONE)).to.equal(true);
    expect((await ctx.vaultAmount()).eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userCollateral)).eq(beforeCol.sub(ONE))).to.equal(true);
    const inv = await ctx.invariantCtx();
    assertOpenSupplyParity(inv, "M-01");
    assertVaultCoversLiability(inv, "M-01");
  });

  it("M-02: second mint accumulates pairs_minted and vault == pairs_minted (fee=0)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.mint(ONE);
    await ctx.mint(new BN(2_500_000));
    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eq(new BN(3_500_000))).to.equal(true);
    assertVaultCoversLiability(inv, "M-02");
    assertOpenSupplyParity(inv, "M-02");
  });

  it("M-04: mint while paused fails with Paused; vault/supplies/pairs_minted unchanged", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.pause();
    await expectErr(ctx.mint(ONE), "Paused");
    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eqn(0)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("M-05: mint when status != Open fails with MarketNotOpen", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.clockUnix - 10 });
    await ctx.adminSettle(ctx.strike, true);
    await expectErr(ctx.mint(ONE), "MarketNotOpen");
  });

  it("M-06: mint at/after expiry_ts fails with MintAfterExpiry", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix - 1 });
    await expectErr(ctx.mint(ONE), "MintAfterExpiry");
  });

  it("M-08: insufficient user USDC → no partial mint (Yes/No not minted)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    try {
      await ctx.mint(new BN("9000000000000"));
      expect.fail("expected insufficient funds failure");
    } catch (e) {
      const inv = await ctx.invariantCtx();
      expect(inv.pairsMinted.eqn(0)).to.equal(true);
      expect(inv.yesSupply.eqn(0)).to.equal(true);
      expect(inv.noSupply.eqn(0)).to.equal(true);
    }
  });

  it("M-01 post: open supply parity helper wired (I2)", () => {
    assertOpenSupplyParity(
      {
        vaultAmount: ONE,
        pairsMinted: ONE,
        pairsRedeemed: new BN(0),
        yesSupply: ONE,
        noSupply: ONE,
        status: 0,
      },
      "M-01/I2"
    );
  });
});
