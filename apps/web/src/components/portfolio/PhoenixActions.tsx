"use client";

/**
 * Cancel resting orders / withdraw the Phoenix seat to the wallet (DLV-087).
 * After a confirmed tx the shared wallet-account + history caches refresh. Success is shown only
 * when every tx confirmed without error (L14); Cancel all may span several txs (L13).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { submitPhoenixManage, type ManageAction } from "@/lib/phoenix/manage";
import type { PhoenixOpenOrder } from "@/lib/portfolio/phoenixTrader";
import { useTxStatus } from "@/components/providers/AppProviders";
import { WALLET_ACCOUNT_KEY } from "@/hooks/useWalletAccount";

function usePhoenixAction(phoenixMarket: string) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { push } = useTxStatus();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function run(action: ManageAction) {
    if (!wallet.connected || !wallet.publicKey) {
      setVisible(true);
      return;
    }
    setBusy(true);
    try {
      const r = await submitPhoenixManage(phoenixMarket, action, {
        connection,
        publicKey: wallet.publicKey,
        sendTransaction: wallet.sendTransaction,
      });
      if (r.ok && r.signature) {
        push("success", `${r.message} · ${r.signature.slice(0, 8)}…`);
      } else if (r.status === "unconfirmed") {
        push("neutral", r.message);
      } else if (r.message === "Wallet rejected the transaction.") {
        push("neutral", r.message);
      } else {
        push("error", r.message);
      }
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: [WALLET_ACCOUNT_KEY] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-history"] });
    }
  }
  return { busy, run };
}

export function CancelOrdersButton({
  phoenixMarket,
  orders,
  label = "Cancel",
  compact = true,
}: {
  phoenixMarket: string;
  orders: Pick<PhoenixOpenOrder, "id" | "side" | "priceInTicks" | "orderSequenceNumber">[];
  label?: string;
  compact?: boolean;
}) {
  const { busy, run } = usePhoenixAction(phoenixMarket);
  return (
    <button
      type="button"
      className="btn"
      aria-busy={busy || undefined}
      disabled={busy || orders.length === 0}
      onClick={() => run({ kind: "cancel", orders })}
      style={compact ? { padding: "0.2rem 0.55rem", fontSize: "0.78rem" } : undefined}
      title="Cancel on Phoenix and return the funds to your wallet"
    >
      {busy ? "Cancelling…" : label}
    </button>
  );
}

export function WithdrawSeatButton({
  phoenixMarket,
  label = "Withdraw to wallet",
  compact = true,
}: {
  phoenixMarket: string;
  label?: string;
  compact?: boolean;
}) {
  const { busy, run } = usePhoenixAction(phoenixMarket);
  return (
    <button
      type="button"
      className="btn btn-primary"
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => run({ kind: "withdraw" })}
      style={compact ? { padding: "0.2rem 0.55rem", fontSize: "0.78rem" } : undefined}
      title="Move filled / free funds from your Phoenix trader account to your wallet"
    >
      {busy ? "Withdrawing…" : label}
    </button>
  );
}
