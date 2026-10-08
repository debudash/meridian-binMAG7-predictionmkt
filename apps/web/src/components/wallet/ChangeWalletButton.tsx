"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CHANGE_WALLET_LABEL } from "@/lib/solana/walletPicker";

/** DLV-115: always-available way to the wallet list (also before connecting / with a stale remembered wallet). */
export function ChangeWalletButton() {
  const { setVisible } = useWalletModal();
  return (
    <button
      type="button"
      className="btn"
      onClick={() => setVisible(true)}
      title="Pick a different wallet"
      aria-label={CHANGE_WALLET_LABEL}
      style={{ height: 36, padding: "0 0.75rem", fontSize: 13, whiteSpace: "nowrap" }}
    >
      <span className="change-wallet-full">{CHANGE_WALLET_LABEL}</span>
      <span className="change-wallet-short" aria-hidden="true">Wallets</span>
    </button>
  );
}
