/**
 * SimClock PDA (D-017 / DLV-065) — SC-01…SC-03.
 * localnet-test only. Does not replace !34 Clock-poll waitPastExpiry for non-sim paths.
 * SimClock PDA is a singleton — initSimClock is idempotent across cases.
 */
import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { TestCtx, expectErr, ONE, loadMeridianIdl } from "./helpers/harness";
import { MarketStatus } from "./helpers/fixtures";

describe("localnet SimClock (D-017 / DLV-065)", function () {
  this.timeout(180000);

  it("SC-01: warp past expiry_ts → settle succeeds (no wall sleep)", async () => {
    const caseId = "SC-01";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.initSimClock();
    await ctx.resetSimClockToNow();

    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await ctx.createMarket({ expiryTs: expiry, pythPrice: 18_100_000_000n });
    await ctx.mint(ONE);

    const sim = await ctx.fetchSimClock();
    const addSecs = expiry - Number(sim.unixTimestamp.toString()) + 5;
    await ctx.warpSimClock(addSecs, 10);

    const simSlot = BigInt((await ctx.fetchSimClock()).slot.toString());
    await ctx.upsertPyth({
      price: 18_100_000_000n,
      keypair: ctx.pythFeed,
      publishSlot: simSlot,
    });
    await ctx.settle();
    const m = await ctx.marketState();
    expect(m.status, caseId).to.equal(MarketStatus.SettledYes);
    expect(Number(m.settledAtTs.toString())).to.be.gte(expiry);
  });

  it("SC-02: after warp past expiry → mint fails MintAfterExpiry", async () => {
    const caseId = "SC-02";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 0 });
    await ctx.initSimClock();
    await ctx.resetSimClockToNow();

    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await ctx.createMarket({ expiryTs: expiry });
    await ctx.mint(ONE);

    const sim = await ctx.fetchSimClock();
    const addSecs = expiry - Number(sim.unixTimestamp.toString()) + 5;
    await ctx.warpSimClock(addSecs, 1);

    await expectErr(ctx.mint(ONE), "MintAfterExpiry");
    void caseId;
  });

  it("SC-03: admin_settle with delay=1800 after warp past expiry+1800 (no wall sleep)", async () => {
    const caseId = "SC-03";
    const ctx = await TestCtx.boot();
    await ctx.setupProtocol({ adminDelay: 1800 });
    await ctx.initSimClock();
    await ctx.resetSimClockToNow();

    const expiry = Math.floor(Date.now() / 1000) + 7200;
    await ctx.createMarket({ expiryTs: expiry });
    await ctx.mint(ONE);

    const sim = await ctx.fetchSimClock();
    const target = expiry + 1800 + 5;
    const addSecs = target - Number(sim.unixTimestamp.toString());
    await ctx.warpSimClock(addSecs, 5);

    await ctx.adminSettle(ctx.strike, true);
    const m = await ctx.marketState();
    expect(m.status, caseId).to.equal(MarketStatus.SettledYes);
    expect(Number(m.settledAtTs.toString())).to.be.gte(expiry + 1800);
  });

  it("SC-IDL: localnet IDL lists init/set/warp/disable_sim_clock", async () => {
    const idl = loadMeridianIdl();
    const names = new Set(idl.instructions.map((i) => i.name));
    for (const ix of ["init_sim_clock", "set_sim_clock", "warp_sim_clock", "disable_sim_clock"]) {
      expect(names.has(ix), `missing ${ix}`).to.equal(true);
    }
  });
});
