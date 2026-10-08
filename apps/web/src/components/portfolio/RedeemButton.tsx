"use client";

/**
 * Portfolio redeem flow — calls program `redeem` when market accounts are known.
 * Rows come from real wallet balances on settled markets (DLV-088); demo rows (localnet
 * fixture mode only) have no on-chain accounts and show a clear message instead.
 */
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getMeridianProgram } from "@/lib/solana/program";
import { buildRedeemIx } from "@/lib/solana/instructions";
import { getUsdcMint, explorerTx } from "@/lib/solana/config";
import { useQueryClient } from "@tanstack/react-query";
import { useTxStatus } from "@/components/providers/AppProviders";
import { WALLET_ACCOUNT_KEY } from "@/hooks/useWalletAccount";
import type { RedeemableRow } from "@/lib/portfolio/account";

export type { RedeemableRow };

export function RedeemButton({ row }: { row: RedeemableRow }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const { push } = useTxStatus();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function onRedeem() {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      setVisible(true);
      return;
    }

    const usdc = getUsdcMint();
    if (
      !row.strikeMarket ||
      !row.collateralVault ||
      !row.winningMint ||
      !row.treasury ||
      !usdc
    ) {
      push(
        "neutral",
        "Redeem accounts not configured for this market (indexer/Schema OPEN). Wire strikeMarket, vault, winningMint, treasury + NEXT_PUBLIC_USDC_MINT to submit redeem.",
      );
      return;
    }

    setBusy(true);
    try {
      const provider = new AnchorProvider(
        connection,
        wallet as unknown as AnchorProvider["wallet"],
        { commitment: "confirmed" },
      );
      const program = getMeridianProgram(provider);
      // amount in outcome base units (6 decimals assumed — TODO(schema) confirm)
      const amount = new BN(Math.round(row.size * 1_000_000));
      const builder = await buildRedeemIx(
        program,
        {
          user: wallet.publicKey,
          strikeMarket: new PublicKey(row.strikeMarket),
          collateralVault: new PublicKey(row.collateralVault),
          winningMint: new PublicKey(row.winningMint),
          collateralMint: usdc,
          treasury: new PublicKey(row.treasury),
        },
        amount,
      );
      const sig = await builder.rpc();
      push("success", `Redeem submitted · ${sig.slice(0, 8)}…`);
      window.open(explorerTx(sig), "_blank", "noopener,noreferrer");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push("error", `Redeem failed: ${msg}`);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: [WALLET_ACCOUNT_KEY] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-history"] });
    }
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy || row.payoutUsdc <= 0}
      onClick={onRedeem}
    >
      {busy ? "Redeeming…" : `Redeem ${row.payoutUsdc.toFixed(2)} USDC`}
    </button>
  );
}
