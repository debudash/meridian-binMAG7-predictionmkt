/**
 * LOCALNET-ONLY dev signer wallet adapter.
 *
 * Lets you sign without a browser extension (Phantom/Solflare) when the app is
 * pointed at a local solana-test-validator. The keypair is served by
 * `/api/localnet-dev-wallet`, which itself refuses unless the same localnet
 * gates pass on the server and `LOCALNET_DEV_WALLET_KEYPAIR` is set.
 *
 * Hard gates (all required, see isLocalnetDevWalletAllowed):
 *   NODE_ENV !== "production" (`next dev` only — a `next build` can never enable it; DLV-080)
 *   NEXT_PUBLIC_SOLANA_CLUSTER=localnet
 *   NEXT_PUBLIC_LOCALNET_DEV_WALLET=true
 *   NEXT_PUBLIC_SOLANA_RPC_URL on loopback (127.0.0.1 / localhost)
 * Devnet/mainnet and all production builds never register this adapter.
 */
import {
  BaseSignerWalletAdapter,
  WalletConnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  type PublicKey,
  type Transaction,
  type TransactionVersion,
  type VersionedTransaction,
} from "@solana/web3.js";

export const LOCALNET_DEV_WALLET_NAME =
  "Localnet Dev Wallet" as WalletName<"Localnet Dev Wallet">;

import { LOOPBACK_RPC } from "@/lib/market/marketIdRoute";

/** Pure gate — safe on server and client. */
export function isLocalnetDevWalletAllowed(env: {
  cluster?: string;
  flag?: string;
  rpcUrl?: string;
  nodeEnv?: string;
} = {
  cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
  flag: process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET,
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  // Inlined by Next at build time → a production bundle constant-folds this gate to false.
  nodeEnv: process.env.NODE_ENV,
}): boolean {
  return (
    env.nodeEnv !== "production" &&
    env.cluster === "localnet" &&
    env.flag === "true" &&
    !!env.rpcUrl &&
    LOOPBACK_RPC.test(env.rpcUrl)
  );
}

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#f59e0b"/><text x="16" y="21" font-size="14" text-anchor="middle" font-family="monospace" fill="#111">DEV</text></svg>',
      )
    : "");

export class LocalnetDevWalletAdapter extends BaseSignerWalletAdapter {
  name = LOCALNET_DEV_WALLET_NAME;
  url = "http://localhost:3000/api/localnet-dev-wallet";
  icon = ICON;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set([
    "legacy",
    0,
  ]);

  private _keypair: Keypair | null = null;
  private _connecting = false;

  get connecting() {
    return this._connecting;
  }

  get publicKey(): PublicKey | null {
    return this._keypair?.publicKey ?? null;
  }

  get readyState() {
    return isLocalnetDevWalletAllowed()
      ? WalletReadyState.Installed
      : WalletReadyState.Unsupported;
  }

  async connect(): Promise<void> {
    if (this.connected || this._connecting) return;
    if (!isLocalnetDevWalletAllowed()) {
      throw new WalletConnectionError("Localnet dev wallet is disabled on this cluster.");
    }
    this._connecting = true;
    try {
      const res = await fetch("/api/localnet-dev-wallet", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`dev wallet endpoint returned ${res.status}`);
      }
      const body = (await res.json()) as { secretKey?: number[] };
      if (!body.secretKey || body.secretKey.length !== 64) {
        throw new Error("dev wallet endpoint returned no keypair");
      }
      this._keypair = Keypair.fromSecretKey(Uint8Array.from(body.secretKey));
      this.emit("connect", this._keypair.publicKey);
    } catch (e) {
      const err = new WalletConnectionError((e as Error)?.message, e);
      this.emit("error", err);
      throw err;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(
    tx: T,
  ): Promise<T> {
    const kp = this._keypair;
    if (!kp) throw new WalletNotConnectedError();
    if ("version" in tx) {
      (tx as VersionedTransaction).sign([kp]);
    } else {
      (tx as Transaction).partialSign(kp);
    }
    return tx;
  }
}
