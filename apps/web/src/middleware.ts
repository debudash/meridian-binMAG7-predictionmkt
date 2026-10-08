/**
 * DLV-089: /markets/<id> with an id that can't be a market → real HTTP 404.
 * The trade page streams under loading.tsx, so notFound() during render can't change the
 * already-sent 200; rejecting impossible ids here happens before rendering starts.
 * (A well-formed pubkey with no StrikeMarket still renders "Market not found" + noindex.)
 */
import { NextResponse, type NextRequest } from "next/server";
// Edge bundle: import the tiny shape checker only (lib/solana/config pulls in web3.js).
import { isFixtureCluster, isPlausibleMarketId } from "@/lib/market/marketIdRoute";

export function middleware(req: NextRequest) {
  const m = /^\/markets\/([^/]+)\/?$/.exec(req.nextUrl.pathname);
  if (m) {
    let id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // malformed escape → implausible
    }
    if (!isPlausibleMarketId(id, isFixtureCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"))) {
      return NextResponse.rewrite(new URL("/404-market", req.url));
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/markets/:id*"] };
