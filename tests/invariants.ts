/**
 * Cluster E — $1 vault & supply invariants P0.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  ONE,
} from "./helpers/harness";
import { MarketStatus } from "./helpers/fixtures";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";

describe("$1 vault / supply invariants P0 (TEST_MATRIX Cluster E)", () => {
  before(() => assertIdlHasInstructions("invariants-suite"));

  it("V-01: fresh market — vault=0; pairs_minted=pairs_redeemed=0; supplies=0", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    const inv = await ctx.invariantCtx();
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
    expect(inv.pairsMinted.eqn(0)).to.equal(true);
    expect(inv.pairsRedeemed.eqn(0)).to.equal(true);
    expect(inv.yesSupply.eqn(0)).to.equal(true);
    expect(inv.noSupply.eqn(0)).to.equal(true);
  });

  it("V-02: after mint path, vault.amount == pairs_minted - pairs_redeemed (fees 0) — core $1 vault", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.mint(ONE);
    await ctx.mint(new BN(2_500_000));
    const inv = await ctx.invariantCtx();
    assertVaultCoversLiability(inv, "V-02");
    expect(inv.vaultAmount.eq(new BN(3_500_000))).to.equal(true);
  });

  it("V-03: after each mint while Open — yes.supply == no.supply == pairs_minted (I2)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket();
    await ctx.mint(ONE);
    assertOpenSupplyParity(await ctx.invariantCtx(), "V-03");
    await ctx.mint(new BN(500_000));
    assertOpenSupplyParity(await ctx.invariantCtx(), "V-03b");
  });

  it("V-04: settled before any redeem — vault still == outstanding pairs (settle did not skim)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 18_100_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
    const before = await ctx.vaultAmount();
    await ctx.settle();
    expect((await ctx.vaultAmount()).eq(before)).to.equal(true);
    expect(before.eq(ONE)).to.equal(true);
  });

  it("V-05: after mix of redeems (fee=0) — vault == pairs_minted - pairs_redeemed; never negative", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    ctx.setMockPyth({ price: 18_100_000_000n, publishSlot: ctx.clockSlot - 1n, pubkey: ctx.pythFeed });
    await ctx.settle();
    await ctx.redeem(new BN(750_000), "yes");
    const inv = await ctx.invariantCtx();
    assertVaultCoversLiability(inv, "V-05");
    expect(inv.vaultAmount.eq(new BN(250_000))).to.equal(true);
    expect(inv.status).to.equal(MarketStatus.SettledYes);
  });
});
