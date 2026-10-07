/**
 * LOCALNET-ONLY: serves the dev signer keypair for LocalnetDevWalletAdapter.
 * 404 unless cluster=localnet, NEXT_PUBLIC_LOCALNET_DEV_WALLET=true, RPC on loopback,
 * the request Host is loopback, and LOCALNET_DEV_WALLET_KEYPAIR (server-only) points
 * at a Solana keypair JSON. Never configure this on devnet/mainnet.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isLocalnetDevWalletAllowed } from "@/lib/solana/localnetDevWallet";

export const dynamic = "force-dynamic";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export async function GET(req: Request) {
  const host = req.headers.get("host") ?? "";
  const path = process.env.LOCALNET_DEV_WALLET_KEYPAIR;
  if (!isLocalnetDevWalletAllowed() || !LOOPBACK_HOST.test(host) || !path) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as number[];
    if (!Array.isArray(raw) || raw.length !== 64) throw new Error("bad keypair");
    return NextResponse.json(
      { secretKey: raw, cluster: "localnet" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "dev wallet keypair unreadable" }, { status: 500 });
  }
}
