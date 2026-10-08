/**
 * DLV-115: a remembered wallet that isn't installed (walletName="Phantom" in localStorage, no extension)
 * must never strand the user on "Connect" → phantom.app. Root cause: WalletProvider had no `onError`, so
 * the adapter's default handler ran `window.open(adapter.url)` on WalletNotReadyError, and nothing ever
 * cleared the stale selection or offered the wallet list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletNotReadyError, WalletReadyState, WalletConnectionError } from "@solana/wallet-adapter-base";
import {
  CHANGE_WALLET_LABEL,
  REMEMBERED_WALLET_GRACE_MS,
  WALLET_NAME_STORAGE_KEY,
  clearRememberedWalletStorage,
  createWalletErrorHandler,
  isWalletReady,
  orderPickerWallets,
  rememberedWalletClearDelayMs,
} from "./walletPicker";
import { LOCALNET_DEV_WALLET_NAME } from "./localnetDevWallet";

const w = (name: string, readyState: WalletReadyState) => ({ adapter: { name }, readyState });

describe("readiness fallback (DLV-115)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only Installed / Loadable count as ready", () => {
    expect(isWalletReady(WalletReadyState.Installed)).toBe(true);
    expect(isWalletReady(WalletReadyState.Loadable)).toBe(true);
    expect(isWalletReady(WalletReadyState.NotDetected)).toBe(false);
    expect(isWalletReady(WalletReadyState.Unsupported)).toBe(false);
  });

  it("Connect on a not-installed remembered wallet clears the selection and opens the picker, never navigates", () => {
    const open = vi.fn();
    const assign = vi.fn();
    const location = { href: "http://127.0.0.1:3000/markets", assign };
    vi.stubGlobal("window", { open, location });
    const clearSelection = vi.fn();
    const openPicker = vi.fn();
    const notify = vi.fn();
    const onError = createWalletErrorHandler({ clearSelection, openPicker, notify, log: () => {} });
    onError(new WalletNotReadyError(), { name: "Phantom", url: "https://phantom.app" });
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/Phantom isn't installed/);
    expect(open).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(location.href).toBe("http://127.0.0.1:3000/markets");
  });

  it("other wallet errors are only logged (no picker, selection kept)", () => {
    const clearSelection = vi.fn();
    const openPicker = vi.fn();
    const log = vi.fn();
    createWalletErrorHandler({ clearSelection, openPicker, log })(new WalletConnectionError("user rejected"));
    expect(clearSelection).not.toHaveBeenCalled();
    expect(openPicker).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a remembered NotDetected wallet is cleared after a short grace (extension injection), Unsupported at once", () => {
    const base = { connected: false, connecting: false };
    expect(rememberedWalletClearDelayMs({ ...base, readyState: WalletReadyState.NotDetected })).toBe(REMEMBERED_WALLET_GRACE_MS);
    expect(rememberedWalletClearDelayMs({ ...base, readyState: WalletReadyState.Unsupported })).toBe(0);
    expect(rememberedWalletClearDelayMs({ ...base, readyState: WalletReadyState.Installed })).toBeNull();
    expect(rememberedWalletClearDelayMs({ ...base, readyState: WalletReadyState.Loadable })).toBeNull();
    expect(rememberedWalletClearDelayMs({ ...base, readyState: undefined })).toBeNull();
    expect(rememberedWalletClearDelayMs({ connected: true, connecting: false, readyState: WalletReadyState.NotDetected })).toBeNull();
    expect(REMEMBERED_WALLET_GRACE_MS).toBeLessThanOrEqual(3_000);
  });

  it("fallback clear removes the adapter's walletName key", () => {
    const store = new Map<string, string>([[WALLET_NAME_STORAGE_KEY, '"Phantom"'], ["other", "1"]]);
    clearRememberedWalletStorage({ removeItem: (k: string) => void store.delete(k) });
    expect(store.has(WALLET_NAME_STORAGE_KEY)).toBe(false);
    expect(store.get("other")).toBe("1");
    expect(WALLET_NAME_STORAGE_KEY).toBe("walletName");
    expect(() => clearRememberedWalletStorage(null)).not.toThrow();
  });
});

describe("picker ordering (DLV-115)", () => {
  const list = [
    w("Backpack", WalletReadyState.Installed), // wallet-standard wallets come first in the adapter list
    w("Phantom", WalletReadyState.NotDetected),
    w(LOCALNET_DEV_WALLET_NAME, WalletReadyState.Installed),
    w("Solflare", WalletReadyState.Loadable),
  ];
  it("localnet with the dev wallet allowed: Localnet Dev Wallet first, others keep their order", () => {
    expect(orderPickerWallets(list, { devWalletAllowed: true }).map((x) => x.adapter.name)).toEqual([
      LOCALNET_DEV_WALLET_NAME, "Backpack", "Phantom", "Solflare",
    ]);
  });
  it("not allowed (devnet / Railway / production build): the dev wallet is never listed", () => {
    expect(orderPickerWallets(list, { devWalletAllowed: false }).map((x) => x.adapter.name)).toEqual([
      "Backpack", "Phantom", "Solflare",
    ]);
  });
});

describe("wiring (DLV-115)", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const read = (f: string) => fs.readFileSync(path.join(__dirname, "../..", f), "utf8");

  it("WalletProvider gets our onError (suppresses the adapter's window.open fallback)", () => {
    const src = read("components/providers/AppProviders.tsx");
    expect(src).toMatch(/onError/);
    expect(src).toMatch(/createWalletErrorHandler\(/);
    expect(src).toMatch(/WalletPickerProvider/);
    expect(src).not.toMatch(/WalletModalProvider as/);
  });

  it("picker provider orders wallets with the DLV-081 gate and clears stale remembered wallets", () => {
    const src = read("components/wallet/WalletPickerProvider.tsx");
    expect(src).toMatch(/orderPickerWallets\(/);
    expect(src).toMatch(/isLocalnetDevWalletAllowed\(\)/);
    expect(src).toMatch(/rememberedWalletClearDelayMs\(/);
    expect(src).toMatch(/WalletModalContext\.Provider/);
  });

  it("header always renders a Change wallet control (not gated on connected)", () => {
    const src = read("components/layout/Header.tsx");
    expect(CHANGE_WALLET_LABEL).toBe("Change wallet");
    const line = src.split("\n").find((l) => l.includes("<ChangeWalletButton"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/connected\s*&&|\?/);
    expect(src).not.toMatch(/!connected\s*&&\s*\(?\s*<ChangeWalletButton/);
  });
});
