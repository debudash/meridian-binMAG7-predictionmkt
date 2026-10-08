"use client";

/**
 * DLV-115: replaces wallet-adapter-react-ui's WalletModalProvider (same WalletModalContext, so
 * `useWalletModal().setVisible` keeps working everywhere) and adds:
 *  - a picker list with the Localnet Dev Wallet first when the DLV-081 gate allows it (never listed otherwise);
 *  - forgetting a remembered wallet that isn't installed (Unsupported now, NotDetected after a short grace
 *    for extension injection), so the header falls back to "Select Wallet" instead of "Connect" → wallet site;
 *  - a bridge for AppProviders' WalletProvider `onError` (clear selection + open picker on WalletNotReadyError).
 */
import { useEffect, useMemo, useState, type ComponentType, type MutableRefObject, type ReactNode } from "react";
import { WalletContext, useWallet, type WalletContextState } from "@solana/wallet-adapter-react";
import { WalletModal, WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { isLocalnetDevWalletAllowed } from "@/lib/solana/localnetDevWallet";
import { orderPickerWallets, rememberedWalletClearDelayMs } from "@/lib/solana/walletPicker";

/* wallet-adapter-react ships its own @types/react; cast the provider for JSX (as AppProviders does). */
const PickerWalletContext = WalletContext.Provider as unknown as ComponentType<{ value: WalletContextState; children?: ReactNode }>;

export interface WalletBridge {
  clearSelection?: () => void;
  openPicker?: () => void;
  notify?: (message: string) => void;
}

export function WalletPickerProvider({ children, bridge }: { children?: ReactNode; bridge: MutableRefObject<WalletBridge> }) {
  const [visible, setVisible] = useState(false);
  const walletCtx = useWallet();
  const { select, wallet, connected, connecting } = walletCtx;
  const devWalletAllowed = isLocalnetDevWalletAllowed();

  useEffect(() => {
    const b = bridge.current;
    b.clearSelection = () => select(null);
    b.openPicker = () => setVisible(true);
    return () => {
      b.clearSelection = undefined;
      b.openPicker = undefined;
    };
  }, [bridge, select]);

  const readyState = wallet?.readyState;
  const walletName = wallet?.adapter.name;
  useEffect(() => {
    if (!walletName) return;
    const delay = rememberedWalletClearDelayMs({ readyState, connected, connecting });
    if (delay === null) return;
    // readyState flips to Installed when the extension injects → this effect re-runs and cancels the timer.
    const t = setTimeout(() => select(null), delay);
    return () => clearTimeout(t);
  }, [walletName, readyState, connected, connecting, select]);

  const pickerCtx = useMemo(
    () => ({ ...walletCtx, wallets: orderPickerWallets(walletCtx.wallets, { devWalletAllowed }) }),
    [walletCtx, devWalletAllowed],
  );
  const modalCtx = useMemo(() => ({ visible, setVisible }), [visible]);

  return (
    <WalletModalContext.Provider value={modalCtx}>
      {children}
      {visible && (
        <PickerWalletContext value={pickerCtx}>
          <WalletModal />
        </PickerWalletContext>
      )}
    </WalletModalContext.Provider>
  );
}
