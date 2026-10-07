/**
 * Cluster E — $1 vault & supply invariants P0 (docs/TEST_MATRIX.md).
 * SCHEMA §7.1–7.3; flows §2; units §3.
 */
import { expect } from "chai";
import BN from "bn.js";
import { invokeIx, TddRedError, assertIdlHasInstructions } from "./helpers/harness";
import { ONE, MarketStatus } from "./helpers/fixtures";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";

describe("$1 vault / supply invariants P0 (TEST_MATRIX Cluster E)", () => {
  before(() => assertIdlHasInstructions("invariants-suite"));

  it("V-01: fresh market — vault=0; pairs_minted=pairs_redeemed=0; supplies=0", async () => {
    const caseId = "V-01";
    try {
      await invokeIx(caseId, "create_strike_market");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("V-02: after mint path, vault.amount == pairs_minted - pairs_redeemed (fees 0) — core $1 vault", async () => {
    const caseId = "V-02";
    // Document expected equality shape for Engineers.
    assertVaultCoversLiability(
      {
        vaultAmount: new BN(3_500_000),
        pairsMinted: new BN(3_500_000),
        pairsRedeemed: new BN(0),
        yesSupply: new BN(3_500_000),
        noSupply: new BN(3_500_000),
        status: MarketStatus.Open,
      },
      caseId
    );
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("V-03: after each mint while Open — yes.supply == no.supply == pairs_minted (I2)", async () => {
    const caseId = "V-03";
    assertOpenSupplyParity(
      {
        vaultAmount: ONE,
        pairsMinted: ONE,
        pairsRedeemed: new BN(0),
        yesSupply: ONE,
        noSupply: ONE,
        status: MarketStatus.Open,
      },
      caseId
    );
    try {
      await invokeIx(caseId, "mint", { amount: ONE });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("V-04: settled before any redeem — vault still == outstanding pairs (settle did not skim)", async () => {
    const caseId = "V-04";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("V-05: after mix of redeems (fee=0) — vault == pairs_minted - pairs_redeemed; never negative", async () => {
    const caseId = "V-05";
    assertVaultCoversLiability(
      {
        vaultAmount: new BN(250_000),
        pairsMinted: new BN(1_000_000),
        pairsRedeemed: new BN(750_000),
        yesSupply: new BN(250_000),
        noSupply: new BN(1_000_000),
        status: MarketStatus.SettledYes,
      },
      caseId
    );
    try {
      await invokeIx(caseId, "redeem", { amount: new BN(250_000) });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });
});
