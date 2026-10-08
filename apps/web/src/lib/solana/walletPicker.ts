/**
 * DLV-115: wallet picker rules (pure, no React).
 *
 * Bug: with `walletName="Phantom"` remembered in localStorage but no Phantom extension, the header showed
 * "Connect" with the Phantom icon and clicking it opened phantom.app. `WalletProvider` had no `onError`,
 * so wallet-adapter's default handler ran `window.open(adapter.url)` on `WalletNotReadyError`, and nothing
 * cleared the stale selection or offered the wallet list, so the Localnet Dev Wallet couldn't be picked.
 */
import { WalletNotReadyError, WalletReadyState } from "@solana/wallet-adapter-base";
import { LOCALNET_DEV_WALLET_NAME } from "./localnetDevWallet";

/** wallet-adapter-react's default `localStorageKey`. */
export const WALLET_NAME_STORAGE_KEY = "walletName";
/** A remembered NotDetected wallet gets this long for its extension to inject before it is forgotten. */
export const REMEMBERED_WALLET_GRACE_MS = 2_500;
export const CHANGE_WALLET_LABEL = "Change wallet";

export function isWalletReady(readyState: WalletReadyState | undefined): boolean {
  return readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
}

/**
 * When to forget the remembered wallet: null = keep it; 0 = now (Unsupported never becomes ready);
 * REMEMBERED_WALLET_GRACE_MS for NotDetected (Phantom/Solflare inject a moment after load).
 */
export function rememberedWalletClearDelayMs(s: {
  readyState: WalletReadyState | undefined;
  connected: boolean;
  connecting: boolean;
}): number | null {
  if (s.connected || s.connecting) return null;
  if (s.readyState === WalletReadyState.Unsupported) return 0;
  if (s.readyState === WalletReadyState.NotDetected) return REMEMBERED_WALLET_GRACE_MS;
  return null;
}

export function isWalletNotReadyError(error: unknown): boolean {
  return error instanceof WalletNotReadyError || (error as { name?: string } | null)?.name === "WalletNotReadyError";
}

/**
 * `WalletProvider` onError. Passing any onError disables the adapter's `window.open(adapter.url)` fallback;
 * a not-ready wallet clears the selection and opens the picker instead (never navigates away).
 */
export function createWalletErrorHandler(deps: {
  clearSelection: () => void;
  openPicker: () => void;
  notify?: (message: string) => void;
  log?: (...args: unknown[]) => void;
}): (error: unknown, adapter?: unknown) => void {
  const log = deps.log ?? ((...a: unknown[]) => console.error(...a));
  return (error, adapter) => {
    if (isWalletNotReadyError(error)) {
      deps.clearSelection();
      deps.openPicker();
      const name = (adapter as { name?: string } | null | undefined)?.name;
      deps.notify?.(`${name ?? "That wallet"} isn't installed in this browser. Pick another wallet.`);
      return;
    }
    log(error, adapter);
  };
}

export function clearRememberedWalletStorage(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  key: string = WALLET_NAME_STORAGE_KEY,
): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* private mode / restricted storage */
  }
}

/**
 * Picker order: the Localnet Dev Wallet first when allowed (DLV-081 gate: localnet + flag + loopback RPC,
 * `next dev` only); never listed otherwise. Everything else keeps the adapter's order.
 */
export function orderPickerWallets<T extends { adapter: { name: string } }>(
  wallets: readonly T[],
  opts: { devWalletAllowed: boolean },
): T[] {
  const isDev = (x: T) => x.adapter.name === LOCALNET_DEV_WALLET_NAME;
  if (!opts.devWalletAllowed) return wallets.filter((x) => !isDev(x));
  return [...wallets.filter(isDev), ...wallets.filter((x) => !isDev(x))];
}
