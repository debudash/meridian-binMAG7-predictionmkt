/**
 * Cluster D — Redeem P0 (docs/TEST_MATRIX.md).
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  expectErr,
  ONE,
} from "./helpers/harness";
import { assertBinaryPayout, assertVaultCoversLiability } from "./helpers/invariants";

async function settleYes(ctx: TestCtx) {
  await ctx.setupProtocol();
  const expiry = Math.floor(Date.now() / 1000) + 2;
  await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });
  await ctx.mint(ONE);
  await ctx.waitPastExpiry();
  await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
  await ctx.settle();
}

async function settleNo(ctx: TestCtx) {
  await ctx.setupProtocol();
  const expiry = Math.floor(Date.now() / 1000) + 2;
  await ctx.createMarket({ expiryTs: expiry, pythPrice: 17_900_000_000n });
  await ctx.mint(ONE);
  await ctx.waitPastExpiry();
  await ctx.upsertPyth({ price: 17_900_000_000n, keypair: ctx.pythFeed });
  await ctx.settle();
}

describe("redeem P0 (TEST_MATRIX Cluster D)", function () {
  this.timeout(180000);
  before(() => assertIdlHasInstructions("redeem-suite"));

  it("R-01: SettledYes + redeem(Yes) burns amount, pays 1:1 USDC, pairs_redeemed += amount", async () => {
    const ctx = await TestCtx.boot();
    await settleYes(ctx);
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const { result: sig } = await ctx.withEvent("redeemed", () => ctx.redeem(ONE, "yes"));
    const paid = (await ctx.tokenBal(ctx.userCollateral)).sub(colBefore);
    assertBinaryPayout(paid, ONE, "R-01");
    const m = await ctx.marketState();
    expect((m.pairsRedeemed as BN).eq(ONE)).to.equal(true);
    void sig;
  });

  it("R-02: SettledNo + redeem(No) pays 1:1 USDC; Yes not redeemable as winner", async () => {
    const ctx = await TestCtx.boot();
    await settleNo(ctx);
    // Losing side (Yes) must not redeem when SettledNo
    await expectErr(ctx.redeem(ONE, "yes"), "InvalidWinningMint");
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const sig = await ctx.redeem(ONE, "no");
    assertBinaryPayout((await ctx.tokenBal(ctx.userCollateral)).sub(colBefore), ONE, "R-02");
    void sig;
  });

  it("R-03: SettledYes but pass No mint → InvalidWinningMint", async () => {
    const ctx = await TestCtx.boot();
    await settleYes(ctx);
    await expectErr(ctx.redeem(ONE, "no"), "InvalidWinningMint");
  });

  it("R-04: redeem while Open fails with MarketNotSettled", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.mint(ONE);
    await expectErr(ctx.redeem(ONE, "yes"), "MarketNotSettled");
  });

  it("R-06: partial redeem then remainder — vault == pairs_minted - pairs_redeemed (fee=0)", async () => {
    const ctx = await TestCtx.boot();
    await settleYes(ctx);
    await ctx.redeem(new BN(400_000), "yes");
    await ctx.redeem(new BN(600_000), "yes");
    const inv = await ctx.invariantCtx();
    assertVaultCoversLiability({ ...inv, feeOnTransferIn: true }, "R-06");
    expect(inv.pairsRedeemed.eq(ONE)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("R-07: redeem more than user winning balance fails; vault unchanged", async () => {
    const ctx = await TestCtx.boot();
    await settleYes(ctx);
    const vaultBefore = await ctx.vaultAmount();
    try {
      await ctx.redeem(new BN(9_999_999_999), "yes");
      expect.fail("expected burn/balance failure");
    } catch {
      expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
    }
  });

  it("R-09: full redeem of all winning supply (fee=0) → vault ~0; pairs_redeemed == pairs_minted", async () => {
    const ctx = await TestCtx.boot();
    await settleYes(ctx);
    await ctx.redeem(ONE, "yes");
    const inv = await ctx.invariantCtx();
    expect(inv.pairsRedeemed.eq(inv.pairsMinted)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });
});
