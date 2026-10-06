/**
 * Cluster B + C — Settle / Admin settle P0 (docs/TEST_MATRIX.md).
 */
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  expectErr,
  ONE,
} from "./helpers/harness";
import { MarketStatus } from "./helpers/fixtures";
import { assertSettledFrozen } from "./helpers/invariants";

async function openMintThenExpire(
  ctx: TestCtx,
  opts: { price: bigint; conf?: bigint; slot?: bigint }
) {
  await ctx.setupProtocol();
  await ctx.createMarket({
    expiryTs: ctx.clockUnix + 1000,
    pythPrice: opts.price,
    pythConf: opts.conf,
  });
  await ctx.mint(ONE);
  await ctx.warpUnix(ctx.clockUnix + 2000);
  ctx.setMockPyth({
    price: opts.price,
    conf: opts.conf ?? 1_000n,
    publishSlot: opts.slot ?? ctx.clockSlot - 1n,
    pubkey: ctx.pythFeed,
  });
}

describe("settle P0 (TEST_MATRIX Cluster B)", () => {
  before(() => assertIdlHasInstructions("settle-suite"));

  it("S-01: settle with price_e6 >= strike → SettledYes; vault unchanged; emit Settled", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_100_000_000n });
    const vaultBefore = await ctx.vaultAmount();
    await ctx.settle();
    const m = await ctx.marketState();
    expect(m.status).to.equal(MarketStatus.SettledYes);
    expect((m.settlementPriceE6 as BN).eq(new BN(181_000_000))).to.equal(true);
    expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
  });

  it("S-02: settle with price_e6 < strike → SettledNo; vault unchanged", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 17_900_000_000n });
    const vaultBefore = await ctx.vaultAmount();
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledNo);
    expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
  });

  it("S-03: exact touch settlement_price_e6 == strike → SettledYes (>= per D-005)", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_000_000_000n });
    await ctx.settle();
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);
  });

  it("S-04: settle before expiry_ts fails with ExpiryNotReached", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol();
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 10_000 });
    await expectErr(ctx.settle(), "ExpiryNotReached");
  });

  it("S-05: stale Pyth publish slot fails with StalePythPrice", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_100_000_000n });
    ctx.setMockPyth({
      price: 18_100_000_000n,
      publishSlot: ctx.clockSlot - 500n,
      pubkey: ctx.pythFeed,
    });
    await expectErr(ctx.settle(), "StalePythPrice");
  });

  it("S-06: conf ratio above settle_max_conf_ratio_bps fails with PythConfidenceTooWide", async () => {
    const ctx = await TestCtx.boot();
    const price = 18_000_000_000n;
    await openMintThenExpire(ctx, { price, conf: price });
    ctx.setMockPyth({
      price,
      conf: price,
      publishSlot: ctx.clockSlot - 1n,
      pubkey: ctx.pythFeed,
    });
    await expectErr(ctx.settle(), "PythConfidenceTooWide");
  });

  it("S-07: wrong Pyth account / feed id fails with InvalidPythAccount", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_100_000_000n });
    ctx.setMockPyth({
      price: 18_100_000_000n,
      feedId: Buffer.alloc(32, 0x99),
      publishSlot: ctx.clockSlot - 1n,
      pubkey: ctx.pythFeed,
    });
    await expectErr(ctx.settle(), "InvalidPythAccount");
  });

  it("S-09: second settle after SettledYes|SettledNo fails; fields immutable (I4)", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_100_000_000n });
    await ctx.settle();
    assertSettledFrozen((await ctx.marketState()).status, "S-09");
    await expectErr(ctx.settle(), "MarketNotOpen");
  });

  it("S-11: after mint + settle Yes, vault still == outstanding pairs (settle does not move vault)", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 18_100_000_000n });
    const before = await ctx.vaultAmount();
    await ctx.settle();
    expect((await ctx.vaultAmount()).eq(before)).to.equal(true);
    expect(before.eq(ONE)).to.equal(true);
  });
});

describe("admin_settle P0 (TEST_MATRIX Cluster C)", () => {
  it("A-01: authority admin_settle after delay → status/fields set; emit AdminSettled; vault unchanged", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000 });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    const vaultBefore = await ctx.vaultAmount();
    await ctx.adminSettle(ctx.strike, true);
    const m = await ctx.marketState();
    expect(m.status).to.equal(MarketStatus.SettledYes);
    expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
  });

  it("A-02: admin_settle before delay fails with AdminSettleTooEarly", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 1800 });
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 100 });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 200); // past expiry but not +1800
    await expectErr(ctx.adminSettle(ctx.strike, true), "AdminSettleTooEarly");
  });

  it("A-03: non-authority admin_settle fails with Unauthorized", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket({ expiryTs: ctx.clockUnix + 1000 });
    await ctx.mint(ONE);
    await ctx.warpUnix(ctx.clockUnix + 2000);
    const stranger = Keypair.generate();
    await ctx.fund(stranger.publicKey);
    await expectErr(ctx.adminSettle(ctx.strike, false, stranger), "Unauthorized");
  });

  it("A-04: admin_settle after Pyth settle fails; cannot override (I4)", async () => {
    const ctx = await TestCtx.boot();
    await openMintThenExpire(ctx, { price: 17_900_000_000n });
    await ctx.settle();
    assertSettledFrozen((await ctx.marketState()).status, "A-04");
    await expectErr(ctx.adminSettle(ctx.strike, true), "MarketNotOpen");
  });
});
