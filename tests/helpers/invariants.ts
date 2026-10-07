/**
 * Invariant helpers I1–I5 from docs/TEST_MATRIX.md / SCHEMA §7.
 * Called as postconditions on happy paths (X-04 / X-05) and vault cases.
 *
 * These assert against live account state once Engineers land the program.
 * Until then, ctx loaders throw TDD_RED (see harness.ts).
 */
import { expect } from "chai";
import BN from "bn.js";

export interface VaultInvariantCtx {
  vaultAmount: BN;
  pairsMinted: BN;
  pairsRedeemed: BN;
  yesSupply: BN;
  noSupply: BN;
  status: number;
  feeOnTransferIn?: boolean;
}

/** I1 — Binary $1: redeem(amount) fee=0 → collateral_out == amount */
export function assertBinaryPayout(collateralOut: BN, amount: BN, caseId: string) {
  expect(
    collateralOut.eq(amount),
    `${caseId} I1: collateral_out (${collateralOut}) must equal amount (${amount})`
  ).to.equal(true);
}

/** I2 — While Open: yes.supply == no.supply == pairs_minted */
export function assertOpenSupplyParity(ctx: VaultInvariantCtx, caseId: string) {
  expect(ctx.status).to.equal(0, `${caseId} I2: status must be Open`);
  expect(
    ctx.yesSupply.eq(ctx.noSupply),
    `${caseId} I2: yes.supply != no.supply`
  ).to.equal(true);
  expect(
    ctx.yesSupply.eq(ctx.pairsMinted),
    `${caseId} I2: supply != pairs_minted`
  ).to.equal(true);
}

/** I3 — Vault covers outstanding pairs (prefer equality when fees skimmed out) */
export function assertVaultCoversLiability(ctx: VaultInvariantCtx, caseId: string) {
  const outstanding = ctx.pairsMinted.sub(ctx.pairsRedeemed);
  expect(
    ctx.vaultAmount.gte(outstanding),
    `${caseId} I3: vault ${ctx.vaultAmount} < outstanding ${outstanding}`
  ).to.equal(true);
  if (ctx.feeOnTransferIn !== false) {
    expect(
      ctx.vaultAmount.eq(outstanding),
      `${caseId} I3 prefer equality: vault ${ctx.vaultAmount} != outstanding ${outstanding}`
    ).to.equal(true);
  }
}

/** I4 — Settled fields immutable (caller asserts settle ix fails) */
export function assertSettledFrozen(
  status: number,
  caseId: string
) {
  expect([2, 3, 4]).to.include(
    status,
    `${caseId} I4: expected SettledYes|SettledNo|Void`
  );
}

/** I5 — Pause policy documented; settle/redeem must remain available */
export const PAUSE_BLOCKS = ["mint", "create_strike_market", "merge_pair"] as const;
export const PAUSE_ALLOWS = ["settle", "redeem", "admin_settle"] as const;
