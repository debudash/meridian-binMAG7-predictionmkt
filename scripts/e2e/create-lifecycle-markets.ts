/**
 * LOCALNET ONLY — hardening E2E phase 0: create strike markets whose mock-Pyth feed keypairs
 * we keep (so the E2E can move the price to strike-touch / below and settle), then append them
 * to a play-state JSON that seed-phoenix.cjs can give Phoenix books.
 *
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8799 ANCHOR_WALLET=~/.config/solana/id.json \
 *   E2E_STATE=/path/state.json E2E_DIR=/path npx ts-node -T scripts/e2e/create-lifecycle-markets.ts
 */
import * as fs from "fs";
import * as path from "path";
import { BN } from "@coral-xyz/anchor";
import { TestCtx } from "../../tests/helpers/harness";

const RPC = process.env.ANCHOR_PROVIDER_URL ?? "";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error(`localnet only; refusing ${RPC}`);
const STATE = process.env.E2E_STATE!;
const DIR = process.env.E2E_DIR!;

const NEW = [
  { symbol: "LCUP", strikeE6: 100_000_000, priceE8: 10_100_000_000n }, // settles at strike-touch → Yes
  { symbol: "LCDN", strikeE6: 100_000_000, priceE8: 9_900_000_000n }, // settles below → No
  { symbol: "LCADM", strikeE6: 100_000_000, priceE8: 10_000_000_000n }, // pause + admin override
];

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const ctx = await TestCtx.boot();
  await ctx.setupProtocol({ adminDelay: 0, mintFeeBps: 0, redeemFeeBps: 0 });
  const expiryBase = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;
  state.lifecycleMarkets = [];
  for (let i = 0; i < NEW.length; i++) {
    const m = NEW[i];
    const b = Buffer.alloc(8, 0x20);
    Buffer.from(m.symbol).copy(b);
    ctx.equity = b;
    ctx.strike = new BN(m.strikeE6);
    ctx.feedId = Buffer.alloc(32, 0x70 + i);
    await ctx.createMarket({ expiryTs: expiryBase + i * 60, strike: ctx.strike, pythPrice: m.priceE8 });
    await ctx.simOpen("E2E");
    const feedPath = path.join(DIR, `feed-${m.symbol}.json`);
    fs.writeFileSync(feedPath, JSON.stringify(Array.from(ctx.pythFeed.secretKey)), { mode: 0o600 });
    const row = {
      symbol: m.symbol,
      strikeE6: m.strikeE6,
      market: ctx.market.toBase58(),
      yesMint: ctx.yesMint.toBase58(),
      noMint: ctx.noMint.toBase58(),
      expiryTs: Number(ctx.expiryTs.toString()),
      pyth: ctx.pythFeed.publicKey.toBase58(),
      pythKeypairPath: feedPath,
      feedIdHex: ctx.feedId.toString("hex"),
      mockPriceE8: m.priceE8.toString(),
    };
    state.markets.push(row);
    state.lifecycleMarkets.push(state.markets.length - 1);
    console.log("created", row.symbol, row.market);
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log("lifecycle idx", state.lifecycleMarkets);
}
main().catch((e) => { console.error(e); process.exit(1); });
