/**
 * STAGING E2E (ops/, copied into a prepared apps/web checkout by run-staging.sh): drives the exact UI order path (fetchMarketViaRpc → placePhoenixOrder)
 * against a Meridian deployment described by $STAGING_STATE, signing with $VERIFY_WALLET.
 *   STAGING_E2E=1 STAGING_STATE=... VERIFY_WALLET=... RPC=... npx vitest run src/lib/phoenix/staging.e2e.test.ts
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const RUN = process.env.STAGING_E2E === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("staging Phoenix order E2E", () => {
  const state = RUN ? JSON.parse(fs.readFileSync(process.env.STAGING_STATE!, "utf8")) : null;
  if (RUN) {
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = process.env.RPC!;
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = process.env.CLUSTER ?? "devnet";
    process.env.NEXT_PUBLIC_MERIDIAN_PROGRAM_ID = state.programId;
    process.env.NEXT_PUBLIC_USDC_MINT = state.usdcMint;
    process.env.NEXT_PUBLIC_PHOENIX_ENABLED = "true";
    process.env.NEXT_PUBLIC_PHOENIX_PROGRAM_ID = state.phoenixProgram;
  }
  const books = RUN ? state.markets.filter((m: any) => m.phoenixMarket && m.fairYes) : [];
  const out: any[] = [];

  async function bal(conn: Connection, mint: string, owner: PublicKey) {
    try { return (await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint), owner), "confirmed")).value.uiAmount ?? 0; } catch { return 0; }
  }

  async function run(intent: "buy-yes" | "buy-no", m: any, size: number) {
    const { fetchMarketViaRpc } = await import("@/lib/indexer/rpc");
    const { placePhoenixOrder } = await import("@/lib/phoenix/client");
    const { getMeridianProgram } = await import("@/lib/solana/program");
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.VERIFY_WALLET!, "utf8"))));
    const conn = new Connection(process.env.RPC!, "confirmed");
    const market = (await fetchMarketViaRpc(m.market))!;
    expect(market.phoenixMarket).toBe(m.phoenixMarket);
    const before = { usdc: await bal(conn, state.usdcMint, kp.publicKey), yes: await bal(conn, m.yesMint, kp.publicKey), no: await bal(conn, m.noMint, kp.publicKey) };
    const r = (x: number) => Math.round(x * 100) / 100;
    const price = intent === "buy-yes" ? market.yesAsk! : r(1 - market.yesBid!);
    const program = getMeridianProgram(new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
    const res = await placePhoenixOrder(
      { phoenixMarket: market.phoenixMarket!, intent, price, size, orderType: "market", tickSize: market.tickSize, worstPrice: price + 0.02,
        strikeMarket: market.marketId, yesMint: market.yesMint, noMint: market.noMint },
      { connection: conn, publicKey: kp.publicKey,
        sendTransaction: async (tx: Transaction, c: Connection) => {
          tx.partialSign(kp);
          const raw = tx.serialize();
          const sig = await c.sendRawTransaction(raw);
          for (let i = 0; i < 60; i++) {
            const st = (await c.getSignatureStatuses([sig])).value[0];
            if (st?.err) throw new Error("tx failed " + JSON.stringify(st.err) + " " + sig);
            if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
            if (i % 5 === 4) await c.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {});
            await sleep(1000);
          }
          throw new Error("not confirmed " + sig);
        },
        program,
        mintAccounts: { user: kp.publicKey, strikeMarket: new PublicKey(market.marketId), collateralVault: new PublicKey(market.collateralVault!),
          yesMint: new PublicKey(market.yesMint!), noMint: new PublicKey(market.noMint!), treasury: new PublicKey(market.treasury!), collateralMint: new PublicKey(state.usdcMint) },
        ensureSeat: true },
    );
    await sleep(1500);
    const after = { usdc: await bal(conn, state.usdcMint, kp.publicKey), yes: await bal(conn, m.yesMint, kp.publicKey), no: await bal(conn, m.noMint, kp.publicKey) };
    const row = { intent, market: `${m.symbol} >= ${m.strikeE6 / 1e6}`, strikeMarket: m.market, price, ok: res.ok, msg: res.message, sig: res.signature, before, after };
    console.log(JSON.stringify(row));
    out.push(row);
    fs.writeFileSync(process.env.E2E_OUT ?? "/tmp/staging-e2e.json", JSON.stringify(out, null, 2));
    return { res, before, after };
  }

  it("Buy Yes 10 @ market fills", async () => {
    const { res, before, after } = await run("buy-yes", books[0], 10);
    expect(res.ok).toBe(true);
    expect(after.yes - before.yes).toBeCloseTo(10, 6);
    expect(before.usdc - after.usdc).toBeGreaterThan(0);
  }, 120_000);

  it("Buy No 10 @ market fills (mint + ask Yes)", async () => {
    const { res, before, after } = await run("buy-no", books[1] ?? books[0], 10);
    expect(res.ok).toBe(true);
    expect(after.no - before.no).toBeCloseTo(10, 6);
    expect(before.usdc - after.usdc).toBeGreaterThan(0);
  }, 120_000);
});
