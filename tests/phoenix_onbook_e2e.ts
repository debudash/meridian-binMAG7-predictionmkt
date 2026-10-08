/**
 * DLV-064 — Phoenix Buy/Sell No **on-book** sim E2E (localnet).
 *
 * Proves compose + Meridian mint/merge + book-sim fills for:
 *   Buy Yes, Sell Yes, Buy No (mint+ask), Sell No (bid+merge).
 *
 * Book-sim models Phoenix match economics (Yes↔USDC between traders) without
 * deploying Phoenix CLOB on solana-test-validator. Residual: full Phoenix.so
 * market create — docs/TEST_MATRIX.md (PHX cases).
 *
 * Case IDs: PHX-01…PHX-06.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TestCtx, ONE } from "./helpers/harness";
import {
  assertOpenSupplyParity,
  assertVaultCoversLiability,
} from "./helpers/invariants";
import {
  planIntentComposition,
  quoteAtomsForYesFill,
  contractsToRaw,
} from "./helpers/phoenix_compose";
import { simTradeOnBook, resolveOnBookMode } from "./helpers/phoenix_onbook";

describe("Phoenix on-book sim E2E (DLV-064 / PHX-*)", function () {
  this.timeout(240000);

  it("PHX-01: compose plans match client packaging (Buy/Sell Yes/No)", () => {
    expect(resolveOnBookMode()).to.equal("book-sim");

    const buyYes = planIntentComposition({
      intent: "buy-yes",
      price: 0.62,
      size: 10,
      orderType: "limit",
    });
    expect(buyYes.packaging).to.equal("phoenix-only");
    expect(buyYes.phoenixSide).to.equal("bid");
    expect(buyYes.needsMint).to.equal(false);

    const sellYes = planIntentComposition({
      intent: "sell-yes",
      price: 0.55,
      size: 5,
      orderType: "limit",
    });
    expect(sellYes.phoenixSide).to.equal("ask");

    const buyNo = planIntentComposition({
      intent: "buy-no",
      price: 0.4,
      size: 25,
      orderType: "market",
    });
    expect(buyNo.needsMint).to.equal(true);
    expect(buyNo.phoenixSide).to.equal("ask");
    expect(buyNo.yesPrice).to.be.closeTo(0.6, 1e-9);
    expect(buyNo.packaging).to.equal("mint-then-phoenix");

    const sellNoMkt = planIntentComposition({
      intent: "sell-no",
      price: 0.35,
      size: 8,
      orderType: "market",
    });
    expect(sellNoMkt.needsMerge).to.equal(true);
    expect(sellNoMkt.mergeBlocked).to.equal(false);
    expect(sellNoMkt.packaging).to.equal("phoenix-then-merge");
    expect(sellNoMkt.yesPrice).to.be.closeTo(0.65, 1e-9);

    const sellNoLim = planIntentComposition({
      intent: "sell-no",
      price: 0.35,
      size: 8,
      orderType: "limit",
    });
    expect(sellNoLim.mergeBlocked).to.equal(true);
    expect(sellNoLim.packaging).to.equal("phoenix-then-merge-todo");

    // size unify: 1 contract → 1e6 raw
    expect(contractsToRaw(1).toString()).to.equal("1000000");
    expect(quoteAtomsForYesFill(1_000_000n, 0.6).toString()).to.equal("600000");
  });

  it("PHX-02: Buy Yes on-book — vault/pairs unchanged by fill; Yes to taker", async () => {
    const caseId = "PHX-02";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);

    const lp = await ctx.bootSecondUser();
    // LP seeds Yes via mint (inventory for the ask side of the book)
    await ctx.mint(ONE, lp.user);

    const before = await ctx.invariantCtx();
    const yesBefore = await ctx.tokenBal(ctx.userYes);

    const result = await simTradeOnBook(ctx, {
      intent: "buy-yes",
      price: 0.6,
      size: 1,
      orderType: "market",
      counterparty: lp.user,
    });
    expect(result.mode).to.equal("book-sim");
    expect(result.plan.phoenixSide).to.equal("bid");

    const after = await ctx.invariantCtx();
    // Fill itself must not move vault/pairs (LP mint already counted in `before`)
    expect(after.pairsMinted.eq(before.pairsMinted), `${caseId}: pairs_minted`).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount), `${caseId}: vault`).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).eq(yesBefore.add(ONE))).to.equal(true);
    assertVaultCoversLiability(after, caseId);
  });

  it("PHX-03: Sell Yes on-book — Yes leaves taker; vault unchanged by fill", async () => {
    const caseId = "PHX-03";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);
    await ctx.mint(ONE); // taker inventory

    const lp = await ctx.bootSecondUser();
    const before = await ctx.invariantCtx();
    const yesBefore = await ctx.tokenBal(ctx.userYes);

    await simTradeOnBook(ctx, {
      intent: "sell-yes",
      price: 0.55,
      size: 1,
      orderType: "market",
      counterparty: lp.user,
    });

    const after = await ctx.invariantCtx();
    expect(after.pairsMinted.eq(before.pairsMinted)).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).eq(yesBefore.sub(ONE))).to.equal(true);
  });

  it("PHX-04: Buy No = mint + ask Yes on-book → taker long No; vault += mint", async () => {
    const caseId = "PHX-04";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);

    const lp = await ctx.bootSecondUser();
    const before = await ctx.invariantCtx();
    const usdcBefore = await ctx.tokenBal(ctx.userCollateral);

    const result = await simTradeOnBook(ctx, {
      intent: "buy-no",
      price: 0.4, // p_no → ask Yes @ 0.60
      size: 1,
      orderType: "market",
      counterparty: lp.user,
    });
    expect(result.plan.packaging).to.equal("mint-then-phoenix");
    expect(result.plan.needsMint).to.equal(true);
    expect(result.quoteRaw.toString()).to.equal("600000");

    const after = await ctx.invariantCtx();
    // Mint added 1e6 to vault/pairs; fill moved Yes to LP but not vault
    expect(after.pairsMinted.eq(before.pairsMinted.add(ONE))).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount.add(ONE))).to.equal(true);
    // Taker: spent 1e6 USDC to mint, received 0.6e6 from ask → net −0.4e6 USDC; holds 1e6 No, 0 Yes
    expect((await ctx.tokenBal(ctx.userYes)).isZero()).to.equal(true);
    expect((await ctx.tokenBal(ctx.userNo)).eq(ONE)).to.equal(true);
    const usdcAfter = await ctx.tokenBal(ctx.userCollateral);
    expect(usdcBefore.sub(usdcAfter).eq(new BN(400_000)), `${caseId}: net USDC`).to.equal(
      true
    );
    assertOpenSupplyParity(after, caseId);
    assertVaultCoversLiability(after, caseId);
  });

  it("PHX-05: Sell No market = bid Yes + merge_pair → USDC back; vault −= merge", async () => {
    const caseId = "PHX-05";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);

    // Taker starts long No (Buy No path once)
    const seedLp = await ctx.bootSecondUser();
    await simTradeOnBook(ctx, {
      intent: "buy-no",
      price: 0.4,
      size: 1,
      orderType: "market",
      counterparty: seedLp.user,
    });
    expect((await ctx.tokenBal(ctx.userNo)).eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).isZero()).to.equal(true);

    const before = await ctx.invariantCtx();
    const usdcBefore = await ctx.tokenBal(ctx.userCollateral);

    // Fresh LP with Yes to sell into our Sell No bid
    const fillLp = await ctx.bootSecondUser();
    await ctx.mint(ONE, fillLp.user);

    const result = await simTradeOnBook(ctx, {
      intent: "sell-no",
      price: 0.35, // p_no → bid Yes @ 0.65
      size: 1,
      orderType: "market",
      counterparty: fillLp.user,
    });
    expect(result.plan.packaging).to.equal("phoenix-then-merge");
    expect(result.plan.needsMerge).to.equal(true);
    expect(result.plan.mergeBlocked).to.equal(false);

    const after = await ctx.invariantCtx();
    // merge burns 1e6 pairs; LP mint +1e6 — net pairs: before had seed mint; +fillLp mint −merge
    // before.pairs = 1 (from Buy No seed). fillLp mint → 2. merge → 1.
    expect(after.pairsMinted.eq(before.pairsMinted.add(ONE).sub(ONE))).to.equal(true);
    // Simpler: after seed Buy No vault=1e6; fillLp mint +1e6; merge −1e6 → vault=1e6
    expect(after.vaultAmount.eq(new BN(1_000_000))).to.equal(true);
    expect((await ctx.tokenBal(ctx.userNo)).isZero(), `${caseId}: No burned`).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).isZero(), `${caseId}: Yes merged`).to.equal(true);

    // Bid paid 0.65e6 USDC for Yes; merge returns 1e6 USDC → net +0.35e6
    const usdcAfter = await ctx.tokenBal(ctx.userCollateral);
    expect(usdcAfter.sub(usdcBefore).eq(new BN(350_000)), `${caseId}: net USDC`).to.equal(
      true
    );
    assertVaultCoversLiability(after, caseId);
  });

  it("PHX-06: demoted off-book fallback still isolates vault (V-08 twin)", async () => {
    const caseId = "PHX-06";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.simOpen(caseId);
    await ctx.mint(ONE);
    const b = await ctx.bootSecondUser();
    const half = new BN(500_000);
    const before = await ctx.invariantCtx();
    await ctx.simTradeOffBook(b.user, half);
    const after = await ctx.invariantCtx();
    expect(after.pairsMinted.eq(before.pairsMinted)).to.equal(true);
    expect(after.vaultAmount.eq(before.vaultAmount)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).eq(half)).to.equal(true);
    expect(
      (await ctx.tokenBal(getAssociatedTokenAddressSync(ctx.yesMint, b.user.publicKey))).eq(half)
    ).to.equal(true);
  });
});
