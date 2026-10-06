/**
 * Cluster A — Mint P0 cases (docs/TEST_MATRIX.md).
 * SCHEMA §5.3, §7.2–7.3; flows §2; units §3.
 *
 * TDD RED until Engineers implement `mint` (+ create/config prerequisites).
 */
import { expect } from "chai";
import BN from "bn.js";
import {
  assertIdlHasInstructions,
  invokeIx,
  TddRedError,
} from "./helpers/harness";
import { ONE } from "./helpers/fixtures";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";

describe("mint P0 (TEST_MATRIX Cluster A)", () => {
  before(() => {
    // Stub IDL must list SCHEMA instruction names even before program build.
    assertIdlHasInstructions("mint-suite");
  });

  it("M-01: mint(1e6) locks USDC and mints equal Yes/No; vault += amount; pairs_minted += amount", async () => {
    const caseId = "M-01";
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      // Postconditions (reachable only after Engineers green the harness):
      // user −1e6 USDC, +1e6 Yes, +1e6 No; vault += 1e6; emit Minted
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e; // keep mocha RED
    }
  });

  it("M-02: second mint accumulates pairs_minted and vault == pairs_minted (fee=0)", async () => {
    const caseId = "M-02";
    try {
      await invokeIx(caseId, "mint", { amount: new BN(2_500_000) });
      assertVaultCoversLiability(
        {
          vaultAmount: new BN(0),
          pairsMinted: new BN(0),
          pairsRedeemed: new BN(0),
          yesSupply: new BN(0),
          noSupply: new BN(0),
          status: 0,
        },
        caseId
      );
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("M-04: mint while paused fails with Paused; vault/supplies/pairs_minted unchanged", async () => {
    const caseId = "M-04";
    try {
      await invokeIx(caseId, "pause");
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: expected Paused error from program`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("M-05: mint when status != Open fails with MarketNotOpen", async () => {
    const caseId = "M-05";
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: expected MarketNotOpen`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("M-06: mint at/after expiry_ts fails with MintAfterExpiry", async () => {
    const caseId = "M-06";
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: expected MintAfterExpiry`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("M-08: insufficient user USDC → no partial mint (Yes/No not minted)", async () => {
    const caseId = "M-08";
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: expected insufficient-funds / transfer failure`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("M-01 post: open supply parity helper wired (I2)", () => {
    // Documents expected postcondition shape for Engineers' fixtures.
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
