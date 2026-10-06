/**
 * Cluster D — Redeem P0 (docs/TEST_MATRIX.md).
 * SCHEMA §5.6, §7.1; flows §5; units §3.
 */
import { expect } from "chai";
import BN from "bn.js";
import { invokeIx, TddRedError, assertIdlHasInstructions } from "./helpers/harness";
import { ONE } from "./helpers/fixtures";
import { assertBinaryPayout, assertVaultCoversLiability } from "./helpers/invariants";

describe("redeem P0 (TEST_MATRIX Cluster D)", () => {
  before(() => assertIdlHasInstructions("redeem-suite"));

  it("R-01: SettledYes + redeem(Yes) burns amount, pays 1:1 USDC, pairs_redeemed += amount", async () => {
    const caseId = "R-01";
    try {
      await invokeIx(caseId, "redeem", { amount: ONE });
      assertBinaryPayout(ONE, ONE, caseId);
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("R-02: SettledNo + redeem(No) pays 1:1 USDC; Yes not redeemable as winner", async () => {
    const caseId = "R-02";
    try {
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("R-03: SettledYes but pass No mint → InvalidWinningMint", async () => {
    const caseId = "R-03";
    try {
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: expected InvalidWinningMint`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("R-04: redeem while Open fails with MarketNotSettled", async () => {
    const caseId = "R-04";
    try {
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: expected MarketNotSettled`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("R-06: partial redeem then remainder — vault == pairs_minted - pairs_redeemed (fee=0)", async () => {
    const caseId = "R-06";
    try {
      await invokeIx(caseId, "redeem", { amount: new BN(400_000) });
      await invokeIx(caseId, "redeem", { amount: new BN(600_000) });
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

  it("R-07: redeem more than user winning balance fails; vault unchanged", async () => {
    const caseId = "R-07";
    try {
      await invokeIx(caseId, "redeem", { amount: new BN(9_999_999_999) });
      expect.fail(`${caseId}: expected balance/burn failure`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("R-09: full redeem of all winning supply (fee=0) → vault ~0; pairs_redeemed == pairs_minted", async () => {
    const caseId = "R-09";
    try {
      await invokeIx(caseId, "redeem", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });
});
