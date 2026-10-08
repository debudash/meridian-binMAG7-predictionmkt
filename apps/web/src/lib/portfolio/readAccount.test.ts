/**
 * DLV-088 — one batched read of everything the UI needs about a wallet: Yes/No/USDC ATAs
 * (getMultipleParsedAccounts) + Phoenix market accounts (getMultipleAccountsInfo) decoded into
 * the wallet's seat + resting orders. RPC failures propagate (callers log + keep last value).
 */
import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readWalletAccount } from "./readAccount";
import type { PhoenixMarketLike } from "./phoenixTrader";

const owner = Keypair.generate().publicKey;
const pk = () => Keypair.generate().publicKey.toBase58();
const m1 = { marketId: pk(), yesMint: pk(), noMint: pk(), phoenixMarket: pk() };
const m2 = { marketId: pk(), yesMint: pk(), noMint: pk(), phoenixMarket: undefined };
const usdcMint = Keypair.generate().publicKey;

const ata = (mint: string | PublicKey) => getAssociatedTokenAddressSync(new PublicKey(mint), owner, true).toBase58();
const parsed = (ui: number) => ({ data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } });

function fakeConnection(balances: Record<string, number>, phoenixData: Record<string, Buffer | null>) {
  return {
    getMultipleParsedAccounts: vi.fn(async (keys: PublicKey[]) => ({
      context: { slot: 1 },
      value: keys.map((k) => (k.toBase58() in balances ? parsed(balances[k.toBase58()]) : null)),
    })),
    getMultipleAccountsInfo: vi.fn(async (keys: PublicKey[]) =>
      keys.map((k) => (phoenixData[k.toBase58()] ? { data: phoenixData[k.toBase58()] } : null)),
    ),
  };
}

const fakeMarket = (traders: PhoenixMarketLike["data"]["traders"]): PhoenixMarketLike => ({
  data: { bids: [], asks: [], traders, traderPubkeyToTraderIndex: new Map([[owner.toBase58(), 1]]) },
  ticksToFloatPrice: (t) => t / 100,
  baseLotsToRawBaseUnits: (l) => l / 1000,
  quoteLotsToQuoteUnits: (l) => l / 1000,
});

describe("readWalletAccount", () => {
  it("combines wallet balances, USDC and the Phoenix seat per market", async () => {
    const conn = fakeConnection(
      { [ata(m1.yesMint)]: 10, [ata(m1.noMint)]: 0, [ata(m2.noMint)]: 3, [ata(usdcMint)]: 250.5 },
      { [m1.phoenixMarket]: Buffer.from("phx") },
    );
    const load = vi.fn(() =>
      fakeMarket(new Map([[owner.toBase58(), { baseLotsFree: 4000, baseLotsLocked: 0, quoteLotsFree: 0, quoteLotsLocked: 0 }]])),
    );
    const acct = await readWalletAccount(conn as never, owner, [m1, m2], { usdcMint, loadMarketState: load });
    expect(acct.usdc).toBe(250.5);
    expect(acct.markets.get(m1.marketId)).toMatchObject({ wallet: { yes: 10, no: 0 }, phoenix: { seat: { yesFree: 4 } } });
    expect(acct.markets.get(m2.marketId)).toEqual({ marketId: m2.marketId, wallet: { yes: 0, no: 3 }, phoenix: null });
    expect(conn.getMultipleParsedAccounts).toHaveBeenCalledTimes(1);
    expect(conn.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("no seat on the book → phoenix null; missing Phoenix account → phoenix null", async () => {
    const conn = fakeConnection({}, { [m1.phoenixMarket]: Buffer.from("phx") });
    const acct = await readWalletAccount(conn as never, owner, [m1], { usdcMint: null, loadMarketState: () => fakeMarket(new Map()) });
    expect(acct.markets.get(m1.marketId)?.phoenix).toBeNull();
    expect(acct.usdc).toBeNull();
  });

  it("an RPC failure rejects (so the hook logs it and keeps the last good value)", async () => {
    const conn = fakeConnection({}, {});
    conn.getMultipleParsedAccounts.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    await expect(readWalletAccount(conn as never, owner, [m1], { usdcMint })).rejects.toThrow("429");
  });

  it("a single undecodable Phoenix account is logged and skipped, not fatal", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const conn = fakeConnection({ [ata(m1.yesMint)]: 1 }, { [m1.phoenixMarket]: Buffer.from("junk") });
    const acct = await readWalletAccount(conn as never, owner, [m1], {
      usdcMint: null,
      loadMarketState: () => {
        throw new Error("bad market header");
      },
    });
    expect(acct.markets.get(m1.marketId)).toMatchObject({ wallet: { yes: 1 }, phoenix: null });
    expect(String(err.mock.calls[0]?.[0])).toContain("bad market header");
    err.mockRestore();
  });

  it("L7 (review mr72-73): a failed Phoenix read is flagged phoenixReadFailed (missing account or decode error); a decoded book with no seat is not", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = await readWalletAccount(fakeConnection({}, { [m1.phoenixMarket]: Buffer.from("junk") }) as never, owner, [m1], {
      usdcMint: null,
      loadMarketState: () => {
        throw new Error("bad market header");
      },
    });
    expect(bad.markets.get(m1.marketId)).toMatchObject({ phoenix: null, phoenixReadFailed: true });
    const missing = await readWalletAccount(fakeConnection({}, {}) as never, owner, [m1], { usdcMint: null, loadMarketState: () => fakeMarket(new Map()) });
    expect(missing.markets.get(m1.marketId)).toMatchObject({ phoenix: null, phoenixReadFailed: true });
    const noSeat = await readWalletAccount(fakeConnection({}, { [m1.phoenixMarket]: Buffer.from("phx") }) as never, owner, [m1], { usdcMint: null, loadMarketState: () => fakeMarket(new Map()) });
    expect(noSeat.markets.get(m1.marketId)?.phoenix).toBeNull();
    expect(noSeat.markets.get(m1.marketId)?.phoenixReadFailed).toBeUndefined();
    err.mockRestore();
  });

  it("chunks >100 accounts", async () => {
    const many = Array.from({ length: 60 }, () => ({ marketId: pk(), yesMint: pk(), noMint: pk() }));
    const conn = fakeConnection({}, {});
    await readWalletAccount(conn as never, owner, many, { usdcMint });
    expect(conn.getMultipleParsedAccounts).toHaveBeenCalledTimes(2); // 121 keys
    expect(conn.getMultipleAccountsInfo).not.toHaveBeenCalled();
  });
});
