/**
 * High-value P1 edges clustered with fees suite (docs/TEST_MATRIX.md).
 * Case IDs: S-08, X-03, M-07, M-09, M-10, V-07, V-08.
 *
 * Prefer fees MR focus — these are invited companions, not an ocean of P2.
 */
import { expect } from "chai";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import {
  assertIdlHasInstructions,
  TestCtx,
  expectErr,
  ONE,
} from "./helpers/harness";
import { assertVaultCoversLiability } from "./helpers/invariants";
import { MarketStatus } from "./helpers/fixtures";

describe("P1 edges (TEST_MATRIX S-08 / X-03 / M-07 / M-09 / M-10 / V-07 / V-08)", function () {
  this.timeout(180000);
  before(() => assertIdlHasInstructions("p1-edges-suite"));

  it("S-08: settle with price <= 0 (or e6==0) fails InvalidPythPrice", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    const expiry = Math.floor(Date.now() / 1000) + 2;
    await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 0n, keypair: ctx.pythFeed });
    await expectErr(ctx.settle(), "InvalidPythPrice");
  });

  it("X-03: admin_settle while paused (delay elapsed) succeeds", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    const expiry = Math.floor(Date.now() / 1000) + 2;
    await ctx.createMarket({ expiryTs: expiry });
    await ctx.mint(ONE);
    await ctx.pause();
    await ctx.waitPastExpiry();
    const vaultBefore = await ctx.vaultAmount();
    await ctx.adminSettle(ctx.strike, true);
    expect((await ctx.marketState()).status).to.equal(MarketStatus.SettledYes);
    expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
  });

  it("M-07: mint(0) fails ZeroAmount (hard reject pinned)", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await expectErr(ctx.mint(new BN(0)), "ZeroAmount");
    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eqn(0)).to.equal(true);
    expect(inv.vaultAmount.eqn(0)).to.equal(true);
  });

  it("M-09: missing Yes or No ATA → account constraint fail; no vault debit", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();

    const stranger = Keypair.generate();
    await ctx.fund(stranger.publicKey);
    const strangerCol = getAssociatedTokenAddressSync(ctx.collateralMint, stranger.publicKey);
    await ctx.provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          ctx.authority.publicKey,
          strangerCol,
          stranger.publicKey,
          ctx.collateralMint
        ),
        createMintToInstruction(
          ctx.collateralMint,
          strangerCol,
          ctx.authority.publicKey,
          BigInt(10_000_000)
        )
      )
    );

    const vaultBefore = await ctx.vaultAmount();
    try {
      await ctx.mint(ONE, stranger);
      expect.fail("M-09: expected missing ATA failure");
    } catch (e) {
      expect((await ctx.vaultAmount()).eq(vaultBefore)).to.equal(true);
      expect(String(e)).to.match(/AccountNotInitialized|could not find account|Error|failed/i);
    }
  });

  it("M-10: two users mint into same market — pairs_minted sums; vault covers; each holds own Yes/No", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(ONE);
    const b = await ctx.bootSecondUser();
    await ctx.mint(new BN(2_500_000), b.user);

    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eq(new BN(3_500_000))).to.equal(true);
    assertVaultCoversLiability(inv, "M-10");
    expect((await ctx.tokenBal(ctx.userYes)).eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(b.userYes)).eq(new BN(2_500_000))).to.equal(true);
    expect((await ctx.tokenBal(b.userNo)).eq(new BN(2_500_000))).to.equal(true);
  });

  it("V-07: under-collateralized redeem must fail InsufficientVault (never pay unbacked USDC)", async () => {
    const caseId = "V-07";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    const expiry = Math.floor(Date.now() / 1000) + 2;
    await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);
    await ctx.waitPastExpiry();
    await ctx.upsertPyth({ price: 18_100_000_000n, keypair: ctx.pythFeed });
    await ctx.settle();

    // Controlled localnet drain: leave vault short of redeem amount
    await ctx.drainVault(new BN(1));
    expect((await ctx.vaultAmount()).eq(ONE.subn(1))).to.equal(true);

    const colBefore = await ctx.tokenBal(ctx.userCollateral);
    const vaultBefore = await ctx.vaultAmount();
    await expectErr(ctx.redeem(ONE, "yes"), "InsufficientVault");
    expect((await ctx.vaultAmount()).eq(vaultBefore), `${caseId}: vault unchanged`).to.equal(true);
    expect(
      (await ctx.tokenBal(ctx.userCollateral)).eq(colBefore),
      `${caseId}: never paid unbacked USDC`
    ).to.equal(true);
  });

  it("V-08: off-protocol Yes transfer between users leaves Meridian vault/pairs_* unchanged", async () => {
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.createMarket();
    await ctx.mint(ONE);

    const b = await ctx.bootSecondUser();
    const half = new BN(500_000);
    await ctx.provider.sendAndConfirm(
      new Transaction().add(
        createTransferInstruction(
          ctx.userYes,
          b.userYes,
          ctx.user.publicKey,
          BigInt(half.toString()),
          [],
          TOKEN_PROGRAM_ID
        )
      ),
      [ctx.user]
    );

    const inv = await ctx.invariantCtx();
    expect(inv.pairsMinted.eq(ONE)).to.equal(true);
    expect(inv.pairsRedeemed.eqn(0)).to.equal(true);
    expect(inv.vaultAmount.eq(ONE)).to.equal(true);
    expect(inv.yesSupply.eq(ONE)).to.equal(true);
    expect((await ctx.tokenBal(ctx.userYes)).eq(half)).to.equal(true);
    expect((await ctx.tokenBal(b.userYes)).eq(half)).to.equal(true);
  });
});
