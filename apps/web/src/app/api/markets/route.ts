/**
 * Market list for client-side account surfaces (Header redeem dot, Portfolio, History). DLV-088
 * Same indexer as the server pages: live RPC/HTTP, fixtures only on localnet (DLV-084).
 */
import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listMarkets();
  return NextResponse.json(result, {
    status: result.source === "unavailable" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
