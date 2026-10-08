/**
 * P2 cluster + remaining invariant gates (docs/TEST_MATRIX.md).
 *
 * Case IDs: A-05, R-08, X-07 + INV-P2-I3, INV-PROD-01, INV-FEE-TRUNC.
 *
 * Program id tip: 3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj (!24/!25).
 * Do **not** change Rust in this suite MR — Engineers implement only to green (D-016).
 * Do **not** invent a Phoenix matcher.
 *
 * Eng pin (this MR):
 *   - A-05: Policy A reject OutcomeInconsistent (D-018)
 *   - X-07: Settling retired/unused (discriminant kept; no transitions)
 * Expected PASS with Eng impl:
 *   - R-08 / INV-P2-I3 (burn_losing on tip IDL)
 *   - INV-PROD-01 (prod IDL omits fixtures)
 *   - INV-FEE-TRUNC (trunc toward zero)
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  ONE,
  TddRedError,
  loadMeridianIdl,
} from "./helpers/harness";
import {
  assertVaultCoversLiability,
  assertBinaryPayout,
} from "./helpers/invariants";
import { MarketStatus } from "./helpers/fixtures";

/** units.md §3 — trunc toward zero (integer div). */
function feeTrunc(amount: BN, bps: number): BN {
  return amount.muln(bps).divn(10_000);
}

const FIXTURE_IX = new Set([
  "upsert_mock_pyth",
  "test_drain_vault",
  "sim_open_session",
  "sim_close_session",
  "sim_open",
  "sim_close",
  "init_sim_clock",
  "set_sim_clock",
  "warp_sim_clock",
  "disable_sim_clock",
]);

describe("P2 gates (TEST_MATRIX A-05 / R-08 / X-07 + INV)", function () {
  this.timeout(240000);
  before(() => assertIdlHasInstructions("p2-gates-suite"));

  /**
   * A-05 — Policy A locked (D-018): reject inconsistent
   *   outcome_yes vs (price_e6 >= strike) with OutcomeInconsistent.
   */
  it("A-05: admin_settle outcome_yes inconsistent with price_e6 vs strike — pin reject (XOR accept+log)", async () => {
    const caseId = "A-05";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack() });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();

    // price_e6 >= strike implies Yes, but authority passes outcome_yes=false
    const priceGeStrike = ctx.strike; // == strike → Yes under D-005 (>=)
    const inconsistentOutcomeYes = false;

    let accepted = false;
    let rejectCode: string | null = null;
    try {
      await ctx.adminSettle(priceGeStrike, inconsistentOutcomeYes);
      accepted = true;
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      for (const code of [
        "OutcomeInconsistent",
        "InvalidOutcome",
        "InconsistentOutcome",
        "OutcomeMismatch",
      ]) {
        if (msg.includes(code)) {
          rejectCode = code;
          break;
        }
      }
      if (!rejectCode) {
        // Unexpected error — surface it
        throw e;
      }
    }

    if (rejectCode) {
      // Policy A locked + implemented — green
      expect(rejectCode).to.be.a("string");
      expect((await ctx.marketState()).status).to.equal(MarketStatus.Open);
      return;
    }

    if (accepted) {
      const m = await ctx.marketState();
      // Silent accept is the doc gap — require Eng to lock accept+log via DECISIONS
      // and a distinguishable log/event marker before flipping this assert.
      throw new TddRedError(
        caseId,
        "admin_settle accepted outcome_yes inconsistent with price_e6 vs strike without a locked policy. " +
          `status=${m.status} settlement_price_e6=${(m.settlementPriceE6 as BN).toString()} ` +
          `strike=${ctx.strike.toString()} outcome_yes=${inconsistentOutcomeYes}. ` +
          "Engineers: implement Policy A reject (OutcomeInconsistent) OR document Policy B accept+log in DECISIONS and flip this test."
      );
    }
  });

  /**
   * R-08 — optional burn_losing after settle.
   * Tip IDL already lists burn_losing (prod + localnet). Expect PASS if harness can invoke.
   */
  it("R-08: burn_losing after settle → loser supply ↓; no USDC; pairs_redeemed unchanged", async () => {
    const caseId = "R-08";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const noBefore = await ctx.mintSupply(ctx.noMint);
    const yesBefore = await ctx.mintSupply(ctx.yesMint);
    const pairsRedeemedBefore = (await ctx.marketState()).pairsRedeemed as BN;
    const vaultBefore = await ctx.vaultAmount();

    const burnAmt = new BN(500_000);
    await ctx.burnLosing(burnAmt, "no");

    expect(
      (await ctx.mintSupply(ctx.noMint)).eq(noBefore.sub(burnAmt)),
      `${caseId}: loser (No) supply must drop by burn amount`
    ).to.equal(true);
    expect(
      (await ctx.mintSupply(ctx.yesMint)).eq(yesBefore),
      `${caseId}: winning Yes supply unchanged`
    ).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore),
      `${caseId}: no USDC movement on burn_losing`
    ).to.equal(true);
    expect(
      ((await ctx.marketState()).pairsRedeemed as BN).eq(pairsRedeemedBefore),
      `${caseId}: pairs_redeemed unchanged`
    ).to.equal(true);
    expect(
      (await ctx.vaultAmount()).eq(vaultBefore),
      `${caseId}: vault unchanged`
    ).to.equal(true);
  });

  /**
   * X-07 — Settling **retired / unused** (D-018).
   * Discriminant 1 kept for layout stability; no ix writes Settling; is_open() is Open-only.
   * create→Open; settle→Settled*. Do not invent Settling transitions or Phoenix matcher.
   */
  it("X-07: Settling status — retired unused (pinned)", async () => {
    const caseId = "X-07";
    // Layout: Settling discriminant retained (=1) but unused — SCHEMA/accounts mark retired.
    expect(MarketStatus.Settling).to.equal(1);
    expect(MarketStatus.Open).to.equal(0);
    expect(MarketStatus.SettledYes).to.equal(2);

    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    expect((await ctx.marketState()).status).to.equal(MarketStatus.Open);

    // Live path never visits Settling: Open → Settled*.
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();
    const st = (await ctx.marketState()).status as number;
    expect(st, `${caseId}: settle skips Settling`).to.equal(MarketStatus.SettledYes);
    expect(st).to.not.equal(MarketStatus.Settling);
  });

  /**
   * INV-P2-I3 — burn_losing must not break vault I3 (pairs liability).
   * Companion to R-08; may already PASS.
   */
  it("INV-P2-I3: after burn_losing, vault I3 still holds (fee=0)", async () => {
    const caseId = "INV-P2-I3";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.expiryAfterMintSlack(), pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();

    await ctx.burnLosing(new BN(250_000), "no");
    const invAfterBurn = await ctx.invariantCtx();
    assertVaultCoversLiability(invAfterBurn, caseId);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    await ctx.redeem(ONE, "yes");
    assertBinaryPayout(
      (await ctx.tokenBal(ctx.userCollateral)).sub(colBefore),
      ONE,
      caseId
    );
    assertVaultCoversLiability(await ctx.invariantCtx(), `${caseId}-post-redeem`);
  });

  /**
   * INV-PROD-01 — prod IDL omits localnet fixtures (mocha twin of scripts/assert-prod-no-fixtures.sh).
   * Does **not** re-run CI strings on .so; reads committed idl/meridian.prod.json only.
   */
  it("INV-PROD-01: idl/meridian.prod.json omits localnet fixture ixs (SIM-09 twin; no CI duplicate)", async () => {
    const caseId = "INV-PROD-01";
    const root = path.resolve(__dirname, "..");
    const prodPath = path.join(root, "idl/meridian.prod.json");
    expect(fs.existsSync(prodPath), `${caseId}: missing ${prodPath}`).to.equal(true);
    const prod = JSON.parse(fs.readFileSync(prodPath, "utf8"));
    const names: string[] = (prod.instructions || []).map((i: { name: string }) => i.name);
    const leaked = names.filter((n) => FIXTURE_IX.has(n));
    expect(leaked, `${caseId}: fixture ixs in prod IDL: ${leaked.join(",")}`).to.deep.equal([]);

    // Localnet IDL (suite build) should still list sim_* — documents dual-IDL gate.
    const local = loadMeridianIdl();
    const localNames = new Set(local.instructions.map((i) => i.name));
    expect(
      localNames.has("sim_open_session") || localNames.has("sim_open"),
      `${caseId}: localnet IDL should keep sim open (suite harness)`
    ).to.equal(true);
  });

  /**
   * INV-FEE-TRUNC — fee = amount * bps / 10_000 trunc toward zero (units.md §3).
   * Documents 1-lamport residual edges for M-03 / R-05 without duplicating those cases.
   */
  it("INV-FEE-TRUNC: fee trunc toward zero (1-lamport residual edges for M-03/R-05)", async () => {
    const caseId = "INV-FEE-TRUNC";
    const bps = 10;

    // Pure unit: amounts where integer div floors to 0 or 1
    expect(feeTrunc(new BN(1), bps).isZero(), `${caseId}: fee(1)=0`).to.equal(true);
    expect(feeTrunc(new BN(999), bps).isZero(), `${caseId}: fee(999)=0`).to.equal(true);
    expect(feeTrunc(new BN(1000), bps).eqn(1), `${caseId}: fee(1000)=1`).to.equal(true);
    expect(feeTrunc(ONE, bps).eqn(1000), `${caseId}: fee(1e6)=1000`).to.equal(true);

    // Live residual: mint amount=999 @ 10 bps → fee=0; vault += 999; no treasury skim
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ mintFeeBps: bps, redeemFeeBps: 0, adminDelay: 0 });
    await ctx.createMarket();
    const amt = new BN(999);
    const fee = feeTrunc(amt, bps);
    expect(fee.isZero()).to.equal(true);
    const treasBefore = await ctx.tokenBal(ctx.treasury);
    await ctx.mint(amt);
    expect((await ctx.vaultAmount()).eq(amt), `${caseId}: vault += amount`).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.treasury)).eq(treasBefore),
      `${caseId}: treasury unchanged when fee truncates to 0`
    ).to.equal(true);
    assertVaultCoversLiability(await ctx.invariantCtx(), caseId);
  });
});
