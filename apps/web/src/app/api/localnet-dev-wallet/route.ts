/**
 * LOCALNET-ONLY: serves the dev signer keypair for LocalnetDevWalletAdapter.
 * 404 unless NODE_ENV is not production (`next dev` only), cluster=localnet,
 * NEXT_PUBLIC_LOCALNET_DEV_WALLET=true, RPC on loopback, the request Host is loopback,
 * the forwarded client address (Next sets x-forwarded-for from the socket when the client
 * didn't) is loopback, and LOCALNET_DEV_WALLET_KEYPAIR (server-only) points at a Solana
 * keypair JSON. Never configure this on devnet/mainnet.
 *
 * DLV-081: Host / x-forwarded-for are client-controlled, so on top of those checks the route
 * refuses whenever this dev server is reachable on a non-loopback interface (probed, see
 * devServerExposure.ts). Run `npm run dev` (binds `-H 127.0.0.1`) — `next dev -H 0.0.0.0`
 * now gets a 404 plus a server-log line explaining why.
 */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { isLocalnetDevWalletAllowed } from "@/lib/solana/localnetDevWallet";
import { devServerExposure } from "@/lib/solana/devServerExposure";

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
  const exposed = await devServerExposure();
  if (exposed) {
    console.error(
      `[dev-wallet] refused: this dev server is reachable off-loopback (${exposed}). ` +
        "Restart it bound to loopback: `npm run dev` (next dev -H 127.0.0.1). DLV-081",
    );
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
