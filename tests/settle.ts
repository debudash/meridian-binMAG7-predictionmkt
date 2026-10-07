/**
 * Cluster B + C — Settle / Admin settle P0 (docs/TEST_MATRIX.md).
 * SCHEMA §3, §5.4–5.5; flows §4; units §§4–5; D-005.
 *
 * Pyth = placeholder fixtures only. No Phoenix matching.
 */
import { expect } from "chai";
import BN from "bn.js";
import { invokeIx, TddRedError, assertIdlHasInstructions } from "./helpers/harness";
import {
  DEFAULT_STRIKE_E6,
  PYTH_PRICE_FEED_PLACEHOLDER,
  MarketStatus,
} from "./helpers/fixtures";
import { assertSettledFrozen } from "./helpers/invariants";

describe("settle P0 (TEST_MATRIX Cluster B)", () => {
  before(() => assertIdlHasInstructions("settle-suite"));

  it("S-01: settle with price_e6 >= strike → SettledYes; vault unchanged; emit Settled", async () => {
    const caseId = "S-01";
    void PYTH_PRICE_FEED_PLACEHOLDER;
    void DEFAULT_STRIKE_E6;
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-02: settle with price_e6 < strike → SettledNo; vault unchanged", async () => {
    const caseId = "S-02";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-03: exact touch settlement_price_e6 == strike → SettledYes (>= per D-005)", async () => {
    const caseId = "S-03";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-04: settle before expiry_ts fails with ExpiryNotReached", async () => {
    const caseId = "S-04";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected ExpiryNotReached`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-05: stale Pyth publish slot fails with StalePythPrice", async () => {
    const caseId = "S-05";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected StalePythPrice`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-06: conf ratio above settle_max_conf_ratio_bps fails with PythConfidenceTooWide", async () => {
    const caseId = "S-06";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected PythConfidenceTooWide`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-07: wrong Pyth account / feed id fails with InvalidPythAccount", async () => {
    const caseId = "S-07";
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected InvalidPythAccount`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-09: second settle after SettledYes|SettledNo fails; fields immutable (I4)", async () => {
    const caseId = "S-09";
    assertSettledFrozen(MarketStatus.SettledYes, caseId);
    try {
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: expected settle reject on settled market`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("S-11: after mint + settle Yes, vault still == outstanding pairs (settle does not move vault)", async () => {
    const caseId = "S-11";
    try {
      await invokeIx(caseId, "mint", { amount: new BN(1_000_000) });
      await invokeIx(caseId, "settle");
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });
});

describe("admin_settle P0 (TEST_MATRIX Cluster C)", () => {
  it("A-01: authority admin_settle after delay → status/fields set; emit AdminSettled; vault unchanged", async () => {
    const caseId = "A-01";
    try {
      await invokeIx(caseId, "admin_settle", {
        settlement_price_e6: DEFAULT_STRIKE_E6,
        outcome_yes: true,
      });
      expect.fail(`${caseId}: unreachable until program lands`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("A-02: admin_settle before delay fails with AdminSettleTooEarly", async () => {
    const caseId = "A-02";
    try {
      await invokeIx(caseId, "admin_settle", {
        settlement_price_e6: DEFAULT_STRIKE_E6,
        outcome_yes: true,
      });
      expect.fail(`${caseId}: expected AdminSettleTooEarly`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("A-03: non-authority admin_settle fails with Unauthorized", async () => {
    const caseId = "A-03";
    try {
      await invokeIx(caseId, "admin_settle", {
        settlement_price_e6: DEFAULT_STRIKE_E6,
        outcome_yes: false,
      });
      expect.fail(`${caseId}: expected Unauthorized`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });

  it("A-04: admin_settle after Pyth settle fails; cannot override (I4)", async () => {
    const caseId = "A-04";
    assertSettledFrozen(MarketStatus.SettledNo, caseId);
    try {
      await invokeIx(caseId, "admin_settle", {
        settlement_price_e6: DEFAULT_STRIKE_E6,
        outcome_yes: true,
      });
      expect.fail(`${caseId}: expected reject on already-settled market`);
    } catch (e) {
      expect(e).to.be.instanceOf(TddRedError);
      throw e;
    }
  });
});
