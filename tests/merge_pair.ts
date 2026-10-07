/**
 * Cluster I — merge_pair (D-018 / Schema !29).
 *
 * Case IDs: MP-01…MP-08.
 *
 * Program id tip: 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6.
 * Do **not** change Rust in this suite MR — Engineers implement only to green (D-016).
 * Do **not** invent a Phoenix matcher. Meridian tests only `merge_pair`;
 * client Sell No = Phoenix bid Yes then merge_pair (on-book / book-sim — DLV-064; not a Meridian matcher).
 *
 * Coordination: A-05 Policy A + X-07 Settling retire covered by P2 suite !27;
 * Schema !29 docs align — this MR does **not** double-flip those cases.
 *
 * Expected RED until Eng lands prod `merge_pair` (IDL + ix).
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  TestCtx,
  expectErr,
  ONE,
  TddRedError,
  loadMeridianIdl,
} from "./helpers/harness";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";
import { MarketStatus } from "./helpers/fixtures";

/** units.md §3 — trunc toward zero (integer div); same path as redeem fee-on-payout. */
function feeOnPayout(amount: BN, bps: number): BN {
  return amount.muln(bps).divn(10_000);
}

describe("merge_pair D-018 (TEST_MATRIX Cluster I / MP-*)", function () {
  this.timeout(240000);

  before(() => {
    // Soft IDL gate — do not poison P0 EXPECTED_INSTRUCTIONS until Eng greens.
    const idl = loadMeridianIdl();
    const names = new Set(idl.instructions.map((i) => i.name));
    if (!names.has("merge_pair") && !names.has("mergePair")) {
      // Suite still runs; each case hits TDD_RED via mergePair() hook.
      // Document the missing prod ix once here for engineers.
      void names;
    }
  });

  /**
   * MP-01 — happy path while Open, !paused, fees 0.
   * Burn equal Yes+No; vault pays amount; pairs_minted -= amount; I2/I3 hold.
   */
  it("MP-01: merge_pair while Open burns Yes+No; vault pays amount; pairs_minted−=; I2/I3", async () => {
    const caseId = "MP-01";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(ONE);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const vaultBefore = await ctx.vaultAmount();
    const pairsBefore = (await ctx.marketState()).pairsMinted as BN;
    expect(pairsBefore.eq(ONE)).to.equal(true);

    const mergeAmt = new BN(400_000);
    await ctx.mergePair(mergeAmt, caseId);

    expect(
      (await ctx.tokenBal(ctx.userYes)).eq(ONE.sub(mergeAmt)),
      `${caseId}: Yes balance −= amount`
    ).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.userNo)).eq(ONE.sub(mergeAmt)),
      `${caseId}: No balance −= amount`
    ).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore.add(mergeAmt)),
      `${caseId}: user USDC += amount (fee=0)`
    ).to.equal(true);
    expect(
      (await ctx.vaultAmount()).eq(vaultBefore.sub(mergeAmt)),
      `${caseId}: vault −= amount`
    ).to.equal(true);
    expect(
      ((await ctx.marketState()).pairsMinted as BN).eq(pairsBefore.sub(mergeAmt)),
      `${caseId}: pairs_minted −= amount`
    ).to.equal(true);

    const inv = await ctx.invariantCtx();
    assertOpenSupplyParity(inv, caseId);
    assertVaultCoversLiability(inv, caseId);
  });

  /**
   * MP-02 — after expiry_ts, still Open: mint fails; merge_pair still OK until settle.
   */
  it("MP-02: after expiry still Open — mint fails; merge_pair still OK", async () => {
    const caseId = "MP-02";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack() });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();

    await expectErr(ctx.mint(ONE), "MintAfterExpiry");

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const mergeAmt = new BN(250_000);
    await ctx.mergePair(mergeAmt, caseId);

    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore.add(mergeAmt)),
      `${caseId}: merge after expiry pays USDC`
    ).to.equal(true);
    expect((await ctx.marketState()).status).to.equal(MarketStatus.Open);
    assertOpenSupplyParity(await ctx.invariantCtx(), caseId);
    assertVaultCoversLiability(await ctx.invariantCtx(), caseId);
  });

  /**
   * MP-03 — pause blocks merge_pair like mint.
   */
  it("MP-03: paused → merge_pair fails Paused; vault/supplies/pairs unchanged", async () => {
    const caseId = "MP-03";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(ONE);
    const before = await ctx.invariantCtx();
    const colBefore = await ctx.tokenBal(ctx.userCollateral);

    await ctx.pause();
    await expectErr(ctx.mergePair(new BN(100_000), caseId), "Paused");

    const after = await ctx.invariantCtx();
    expect(after.pairsMinted.eq(before.pairsMinted)).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount)).to.equal(true);
    expect(after.yesSupply.eq(before.yesSupply)).to.equal(true);
    expect(after.noSupply.eq(before.noSupply)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userCollateral)).eq(colBefore)).to.equal(true);
  });

  /**
   * MP-04 — settled market: merge_pair fails MarketNotOpen.
   */
  it("MP-04: settled → merge_pair fails MarketNotOpen", async () => {
    const caseId = "MP-04";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);

    await expectErr(ctx.mergePair(new BN(100_000), caseId), "MarketNotOpen");
  });

  /**
   * MP-05 — fee-on-payout like redeem: fee = amount * redeem_fee_bps / 10_000;
   * user gets amount − fee; treasury += fee from vault; pairs_minted −= amount.
   */
  it("MP-05: redeem_fee_bps=10 → user gets amount−fee; treasury+=fee; pairs_minted−=", async () => {
    const caseId = "MP-05";
    const FEE_BPS = 10;
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0, redeemFeeBps: FEE_BPS });
    await ctx.createMarket();
    await ctx.mint(ONE);

    const mergeAmt = ONE;
    const fee = feeOnPayout(mergeAmt, FEE_BPS);
    expect(fee.eqn(1_000), `${caseId}: fee = 1e6 * 10 / 10000`).to.equal(true);
    const out = mergeAmt.sub(fee);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const treasBefore = await ctx.tokenBal(ctx.treasury);
    const vaultBefore = await ctx.vaultAmount();

    await ctx.mergePair(mergeAmt, caseId);

    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore.add(out)),
      `${caseId}: user gets amount − fee`
    ).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.treasury)).sub(treasBefore).eq(fee),
      `${caseId}: treasury += fee from vault`
    ).to.equal(true);
    expect(
      (await ctx.vaultAmount()).eq(vaultBefore.sub(mergeAmt)),
      `${caseId}: vault drops by full amount (user+treasury)`
    ).to.equal(true);
    expect(
      ((await ctx.marketState()).pairsMinted as BN).isZero(),
      `${caseId}: pairs_minted −= amount → 0`
    ).to.equal(true);
    // After full merge, Open supply parity still holds (all zero).
    assertOpenSupplyParity(await ctx.invariantCtx(), caseId);
    assertVaultCoversLiability(await ctx.invariantCtx(), caseId);
  });

  /**
   * MP-06 — vault I2/I3 after partial merge: yes.supply == no.supply == pairs_minted;
   * vault liability holds.
   */
  it("MP-06: after merge, yes.supply == no.supply == pairs_minted; vault I3 holds", async () => {
    const caseId = "MP-06";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(new BN(2_000_000));
    await ctx.mergePair(new BN(750_000), caseId);

    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eq(new BN(1_250_000))).to.equal(true);
    assertOpenSupplyParity(inv, caseId);
    assertVaultCoversLiability(inv, caseId);
  });

  /**
   * MP-07 — zero amount + insufficient Yes/No.
   */
  it("MP-07: amount=0 → ZeroAmount; insufficient Yes/No → fail; no partial state", async () => {
    const caseId = "MP-07";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(ONE);
    const before = await ctx.invariantCtx();

    await expectErr(ctx.mergePair(new BN(0), caseId), "ZeroAmount");

    // Request more than user holds (and more than pairs) — must fail without mutating.
    try {
      await ctx.mergePair(new BN(2_000_000), caseId);
      expect.fail(`${caseId}: expected insufficient Yes/No merge to fail`);
    } catch (e) {
      if (e instanceof TddRedError) throw e;
      // Token burn / InsufficientFunds / constraint — any hard fail is OK
      expect(String(e).length > 0).to.equal(true);
    }

    const after = await ctx.invariantCtx();
    expect(after.pairsMinted.eq(before.pairsMinted)).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount)).to.equal(true);
    expect(after.yesSupply.eq(before.yesSupply)).to.equal(true);
    expect(after.noSupply.eq(before.noSupply)).to.equal(true);
  });

  /**
   * MP-08 — distinct from redeem / burn_losing:
   * while Open, redeem fails; merge works.
   * after settle, merge fails; redeem works (fee=0).
   * Does not invoke burn_losing (R-08 owned by P2 !27).
   */
  it("MP-08: distinct from redeem — Open: merge OK / redeem fails; Settled: merge fails / redeem OK", async () => {
    const caseId = "MP-08";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);

    // Open: redeem must not run; merge_pair is the unwind path
    await expectErr(ctx.redeem(new BN(100_000), "yes"), "MarketNotSettled");
    await ctx.mergePair(new BN(100_000), caseId);
    assertOpenSupplyParity(await ctx.invariantCtx(), `${caseId}-open`);

    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);

    await expectErr(ctx.mergePair(new BN(100_000), caseId), "MarketNotOpen");

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const redeemAmt = new BN(100_000);
    await ctx.redeem(redeemAmt, "yes");
    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore.add(redeemAmt)),
      `${caseId}: redeem still pays winning Yes after settle`
    ).to.equal(true);
  });
});
