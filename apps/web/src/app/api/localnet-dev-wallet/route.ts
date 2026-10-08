/**
 * LOCALNET-ONLY: serves the dev signer keypair for LocalnetDevWalletAdapter.
 * 404 unless NODE_ENV is not production (`next dev` only), cluster=localnet,
 * NEXT_PUBLIC_LOCALNET_DEV_WALLET=true, RPC on loopback, the request Host is loopback,
 * the forwarded client address (Next sets x-forwarded-for from the socket when the client
 * didn't) is loopback, and LOCALNET_DEV_WALLET_KEYPAIR (server-only) points at a Solana
 * keypair JSON. Never configure this on devnet/mainnet.
 *
 * Residual (DLV-081): Host / x-forwarded-for are client-controlled, so a peer that can reach
 * a dev server bound to 0.0.0.0 and spoofs both headers still gets the (localnet-only) key.
 * Bind `next dev -H 127.0.0.1` when the box is reachable from a shared network.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isLocalnetDevWalletAllowed } from "@/lib/solana/localnetDevWallet";

export const dynamic = "force-dynamic";

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOOPBACK_ADDR = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i;

function forwardedClientIsLoopback(req: Request): boolean {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return true; // direct call (no proxy hop) — Host check still applies
  return xff.split(",").every((a) => LOOPBACK_ADDR.test(a.trim()));
}

export async function GET(req: Request) {
  const host = req.headers.get("host") ?? "";
  const path = process.env.LOCALNET_DEV_WALLET_KEYPAIR;
  if (!isLocalnetDevWalletAllowed() || !LOOPBACK_HOST.test(host) || !forwardedClientIsLoopback(req) || !path) {
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
