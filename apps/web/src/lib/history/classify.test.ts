/**
 * DLV-088 — History from the wallet's own transactions (not demo rows). Each signed tx is
 * classified from its instructions (Meridian ix discriminator, Phoenix ix tag) and the wallet's
 * token balance deltas for known market mints + USDC.
 */
import { describe, expect, it } from "vitest";
import { utils } from "@coral-xyz/anchor";
const bs58 = utils.bytes.bs58;
import { buildHistoryIndex, classifyTransaction, settlementRows, type HistoryRow } from "./classify";
import type { MarketView } from "@/lib/market/types";

const OWNER = "G5dtmt73NNcDramXQUr6ckfNP9umAWwjpRwsMh7jUTLY";
const MERIDIAN = "9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6";
const PHOENIX = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";
const USDC = "CivjforuEL9GrMsFzJLhYkfS87ZE3NoKRzpVFn35ynE4";
const market = {
  marketId: "MKT1111111111111111111111111111111111111111",
  question: "NVDA ≥ $135?",
  yesMint: "YES1111111111111111111111111111111111111111",
  noMint: "NO11111111111111111111111111111111111111111",
  phoenixMarket: "PHX1111111111111111111111111111111111111111",
  status: "open",
} as unknown as MarketView;
const DISC = { mint: [51, 57, 225, 47, 182, 146, 137, 166], merge_pair: [30, 61, 163, 68, 40, 68, 160, 222], redeem: [184, 12, 86, 149, 70, 196, 97, 225] };
const idx = buildHistoryIndex([market], { usdcMint: USDC, meridianProgramId: MERIDIAN, phoenixProgramId: PHOENIX });

const meridianIx = (name: keyof typeof DISC) => ({ programId: MERIDIAN, accounts: [], data: bs58.encode(Buffer.from([...DISC[name], 1, 2, 3])) });
const phoenixIx = (tag: number) => ({ programId: PHOENIX, accounts: [PHOENIX, "LOG", market.phoenixMarket, OWNER], data: bs58.encode(Buffer.from([tag, 0, 0])) });
const bal = (mint: string, ui: number, owner = OWNER) => ({ accountIndex: 1, mint, owner, uiTokenAmount: { uiAmount: ui, amount: String(ui * 1e6), decimals: 6, uiAmountString: String(ui) } });

function tx(ixs: unknown[], pre: ReturnType<typeof bal>[], post: ReturnType<typeof bal>[], over: Record<string, unknown> = {}) {
  return {
    blockTime: 1_791_400_000,
    slot: 10,
    meta: { err: null, preTokenBalances: pre, postTokenBalances: post, fee: 5000, ...over },
    transaction: { message: { instructions: ixs } },
  };
}
const classify = (t: unknown) => classifyTransaction("SIG", t as never, OWNER, idx) as HistoryRow;

describe("classifyTransaction", () => {
  it("market Buy Yes (Phoenix swap): +Yes, −USDC → price = USDC / Yes", () => {
    const r = classify(tx([phoenixIx(0)], [bal(USDC, 100)], [bal(USDC, 95.5), bal(market.yesMint!, 10)]));
    expect(r).toMatchObject({ type: "trade", marketId: market.marketId, intent: "Buy Yes", side: "yes", size: 10, usdcDelta: -4.5 });
    expect(r.price).toBeCloseTo(0.45);
  });

  it("Sell Yes fill: −Yes, +USDC", () => {
    const r = classify(tx([phoenixIx(0)], [bal(USDC, 0), bal(market.yesMint!, 10)], [bal(USDC, 5.5), bal(market.yesMint!, 0)]));
    expect(r).toMatchObject({ intent: "Sell Yes", size: 10 });
    expect(r.price).toBeCloseTo(0.55);
  });

  it("Buy No = Meridian mint + Phoenix ask: +No, USDC −(1 − pYes)", () => {
    const r = classify(tx([meridianIx("mint"), phoenixIx(0)], [bal(USDC, 100)], [bal(USDC, 94), bal(market.noMint!, 10), bal(market.yesMint!, 0)]));
    expect(r).toMatchObject({ type: "trade", intent: "Buy No", side: "no", size: 10 });
    expect(r.price).toBeCloseTo(0.6);
  });

  it("resting Buy No (ask rests, nothing sold yet) → order row, no price", () => {
    const r = classify(tx([meridianIx("mint"), phoenixIx(2)], [bal(USDC, 100)], [bal(USDC, 90), bal(market.noMint!, 10)]));
    expect(r).toMatchObject({ type: "order", intent: "Buy No (resting)", size: 10 });
    expect(r.price).toBeUndefined();
  });

  it("Sell No = Phoenix bid + merge_pair: −No, +USDC", () => {
    const r = classify(tx([phoenixIx(0), meridianIx("merge_pair")], [bal(USDC, 0), bal(market.noMint!, 10)], [bal(USDC, 3.5), bal(market.noMint!, 0)]));
    expect(r).toMatchObject({ type: "trade", intent: "Sell No", side: "no", size: 10 });
    expect(r.price).toBeCloseTo(0.35);
  });

  it("resting limit bid: USDC locked, no Yes yet → order row", () => {
    const r = classify(tx([phoenixIx(2)], [bal(USDC, 100)], [bal(USDC, 97.3)]));
    expect(r).toMatchObject({ type: "order", intent: "Limit bid (resting)", usdcDelta: -2.7, marketId: market.marketId });
  });

  it("cancel (+ withdraw) → cancel row with what came back", () => {
    const r = classify(tx([phoenixIx(10), phoenixIx(12)], [bal(USDC, 97.3)], [bal(USDC, 100), bal(market.yesMint!, 4)]));
    expect(r).toMatchObject({ type: "cancel", marketId: market.marketId, yesDelta: 4, usdcDelta: 2.7 });
  });

  it("withdraw only → withdraw row", () => {
    const r = classify(tx([phoenixIx(12)], [], [bal(market.yesMint!, 4)]));
    expect(r).toMatchObject({ type: "withdraw", yesDelta: 4 });
  });

  it("redeem → redemption with payout", () => {
    const r = classify(tx([meridianIx("redeem")], [bal(market.yesMint!, 7), bal(USDC, 0)], [bal(market.yesMint!, 0), bal(USDC, 7)]));
    expect(r).toMatchObject({ type: "redemption", side: "yes", size: 7, usdcDelta: 7 });
  });

  it("failed tx, unrelated tx, and other owners' balances are ignored", () => {
    expect(classifyTransaction("S", tx([phoenixIx(0)], [], [bal(market.yesMint!, 1)], { err: { InstructionError: [0, "x"] } }) as never, OWNER, idx)).toBeNull();
    expect(classifyTransaction("S", tx([{ programId: "11111111111111111111111111111111", accounts: [], data: "" }], [], []) as never, OWNER, idx)).toBeNull();
    const r = classify(tx([phoenixIx(0)], [bal(USDC, 100), bal(USDC, 0, "SOMEONE")], [bal(USDC, 95.5), bal(USDC, 4.5, "SOMEONE"), bal(market.yesMint!, 10)]));
    expect(r.usdcDelta).toBe(-4.5);
  });
});

describe("settlementRows", () => {
  it("one row per settled market the wallet traded, at resolvedAt with the result", () => {
    const settled = { ...market, status: "settled-yes", outcome: "yes", resolvedAt: 1_791_500_000, resolvedPrice: 136.2 } as MarketView;
    const rows = settlementRows([settled, { ...market, marketId: "OTHER", status: "settled-no" } as MarketView], new Set([market.marketId]));
    expect(rows).toEqual([
      expect.objectContaining({ type: "settlement", marketId: market.marketId, ts: 1_791_500_000, intent: "Result: Yes", price: 136.2 }),
    ]);
  });
});
