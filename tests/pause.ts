/**
 * Cluster F — Pause & cross-phase lifecycle P0 (docs/TEST_MATRIX.md).
 * SCHEMA §5.7, §7.5; flows §1, §7.
 */
import { expect } from "chai";
import BN from "bn.js";
import { invokeIx, TddRedError, assertIdlHasInstructions } from "./helpers/harness";
import { ONE, DEFAULT_STRIKE_E6 } from "./helpers/fixtures";
import {
  PAUSE_ALLOWS,
  PAUSE_BLOCKS,
  assertVaultCoversLiability,
  assertBinaryPayout,
} from "./helpers/invariants";

describe("pause + lifecycle P0 (TEST_MATRIX Cluster F)", () => {
  before(() => assertIdlHasInstructions("pause-suite"));

  it("X-01: after pause, mint and create_strike_market fail with Paused", async () => {
    const caseId = "X-01";
    expect(PAUSE_BLOCKS).to.include("mint");
    expect(PAUSE_BLOCKS).to.include("create_strike_market");
    try {
      await invokeIx(caseId, "pause");
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: expected Paused on mint`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("X-02: while paused, settle then redeem still succeed (I5)", async () => {
    const caseId = "X-02";
    expect(PAUSE_ALLOWS).to.include("settle");
    expect(PAUSE_ALLOWS).to.include("redeem");
    try {
      await invokeIx(caseId, "pause");
      await invokeIx(caseId, "settle");
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("X-04: e2e fee=0 SettledYes — create → mint → warp expiry → settle ≥strike → redeem Yes", async () => {
    const caseId = "X-04";
    void DEFAULT_STRIKE_E6;
    try {
      await invokeIx(caseId, "create_strike_market");
      await invokeIx(caseId, "mint", { amount: ONE });
      // optional: set_phoenix_market (pubkey wiring only — no matching)
      await invokeIx(caseId, "set_phoenix_market");
      await invokeIx(caseId, "settle");
      await invokeIx(caseId, "redeem", { amount: ONE });
      assertBinaryPayout(ONE, ONE, caseId);
      assertVaultCoversLiability(
        {
          vaultAmount: new BN(0),
          pairsMinted: ONE,
          pairsRedeemed: ONE,
          yesSupply: new BN(0),
          noSupply: ONE,
          status: 2,
        },
        caseId
      );
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("X-05: e2e SettledNo — mint → settle <strike → redeem No", async () => {
    const caseId = "X-05";
    try {
      await invokeIx(caseId, "create_strike_market");
      await invokeIx(caseId, "mint", { amount: ONE });
      await invokeIx(caseId, "settle");
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("X-06: mint → settle → second settle fails (I4)", async () => {
    const caseId = "X-06";
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      await invokeIx(caseId, "settle");
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected second settle to fail`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });
});
