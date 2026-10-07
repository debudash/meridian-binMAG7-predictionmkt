/**
 * Cluster A/D/E — P1 fee cases (docs/TEST_MATRIX.md).
 *
 * TDD P1 contract: M-03 / R-05 / V-06. Engineers implement / confirm fee paths
 * only to green these asserts. Do not weaken P0 fee=0 cases.
 *
 * Note: eng/p0-anchor-impl already ships mint/redeem fee math (fee-on-transfer-in).
 * This suite is the formal P1 gate — stay RED until non-zero bps accounting holds.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  ONE,
} from "./helpers/harness";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";

const FEE_BPS = 10; // 0.10%

function feeOn(amount: BN, bps: number): BN {
  return amount.muln(bps).divn(10_000);
}

describe("P1 fees (TEST_MATRIX M-03 / R-05 / V-06)", function () {
  this.timeout(180000);
  before(() => assertIdlHasInstructions("fees-p1-suite"));

  it("M-03: mint_fee_bps=10 → user pays amount+fee; vault+=amount only; treasury+=fee; pairs/supplies+=amount", async () => {
    const caseId = "M-03";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ mintFeeBps: FEE_BPS, redeemFeeBps: 0, adminDelay: 0 });
    await ctx.createMarket();

    const fee = feeOn(ONE, FEE_BPS);
    expect(fee.eqn(1_000), `${caseId}: fee = 1e6 * 10 / 10000`).to.equal(true);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const treasBefore = await ctx.tokenBal(ctx.treasury);

    await ctx.mint(ONE);

    const colAfter = await ctx.tokenBal(ctx.userCollateral);
    const paid = colBefore.sub(colAfter);
    expect(paid.eq(ONE.add(fee)), `${caseId}: collateral_in = amount + fee`).to.equal(true);

    expect((await ctx.vaultAmount()).eq(ONE), `${caseId}: vault += amount only (fee skimmed)`).to.equal(
      true
    );
    expect(
      (await ctx.tokenBal(ctx.treasury)).sub(treasBefore).eq(fee),
      `${caseId}: treasury += fee`
    ).to.equal(true);

    expect((await ctx.tokenBal(ctx.userYes)).eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userNo)).eq(ONE)).to.equal(true);

    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eq(ONE)).to.equal(true);
    assertOpenSupplyParity(inv, caseId);
    assertVaultCoversLiability({ ...inv, feeOnTransferIn: true }, caseId);
  });

  it("R-05: redeem_fee_bps=10 → user gets amount-fee; treasury+=fee from vault; vault drops by full amount; pairs_redeemed+=amount", async () => {
    const caseId = "R-05";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ mintFeeBps: 0, redeemFeeBps: FEE_BPS, adminDelay: 0 });
    const expiry = Math.floor(Date.now() / 1000) + 2;
    await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();

    const fee = feeOn(ONE, FEE_BPS);
    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const treasBefore = await ctx.tokenBal(ctx.treasury);
    const vaultBefore = await ctx.vaultAmount();
    expect(vaultBefore.eq(ONE)).to.equal(true);

    await ctx.redeem(ONE, "yes");

    const paid = (await ctx.tokenBal(ctx.userCollateral)).sub(colBefore);
    expect(paid.eq(ONE.sub(fee)), `${caseId}: user gets amount - fee`).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.treasury)).sub(treasBefore).eq(fee),
      `${caseId}: treasury += fee from vault`
    ).to.equal(true);
    expect(
      (await ctx.vaultAmount()).eqn(0),
      `${caseId}: vault drops by full amount (user+treasury)`
    ).to.equal(true);

    const inv = await ctx.invariantCtx();
    expect(inv.pairsRedeemed.eq(ONE)).to.equal(true);
    assertVaultCoversLiability({ ...inv, feeOnTransferIn: true }, caseId);
  });

  it("V-06: mint+redeem fees on — vault holds liability only; fees only in treasury; equality under fee-on-transfer-in", async () => {
    const caseId = "V-06";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({
      mintFeeBps: FEE_BPS,
      redeemFeeBps: FEE_BPS,
      adminDelay: 0,
    });
    const expiry = Math.floor(Date.now() / 1000) + 2;
    await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });

    const mintFee = feeOn(ONE, FEE_BPS);
    const treas0 = await ctx.tokenBal(ctx.treasury);

    await ctx.mint(ONE);
    expect((await ctx.vaultAmount()).eq(ONE), `${caseId}: after mint vault == liability`).to.equal(
      true
    );
    expect((await ctx.tokenBal(ctx.treasury)).sub(treas0).eq(mintFee)).to.equal(true);

    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.vaultAmount()).eq(ONE), `${caseId}: settle does not move vault`).to.equal(
      true
    );

    const redeemFee = feeOn(ONE, FEE_BPS);
    const treas1 = await ctx.tokenBal(ctx.treasury);
    await ctx.redeem(ONE, "yes");

    expect((await ctx.tokenBal(ctx.treasury)).sub(treas1).eq(redeemFee)).to.equal(true);
    const inv = await ctx.invariantCtx();
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
    assertVaultCoversLiability({ ...inv, feeOnTransferIn: true }, caseId);
    // Fees never left in vault — total treasury skim = mintFee + redeemFee
    expect((await ctx.tokenBal(ctx.treasury)).sub(treas0).eq(mintFee.add(redeemFee))).to.equal(
      true
    );
  });
});
