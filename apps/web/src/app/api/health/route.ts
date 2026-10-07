import { NextResponse } from "next/server";

/** Railway / ops health probe — no secrets, always 200 when process is up. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "meridian-web" },
    { status: 200 }
  );
}
