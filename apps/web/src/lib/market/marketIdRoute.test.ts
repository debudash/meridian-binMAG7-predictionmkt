/**
 * DLV-089 — /markets/<garbage> must be a real HTTP 404. The page streams under loading.tsx, so a
 * notFound() thrown while rendering arrives after the 200 header; middleware rejects ids that
 * can't possibly be a market before rendering starts.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPlausibleMarketId } from "./marketIdRoute";
import { middleware } from "@/middleware";

describe("isPlausibleMarketId", () => {
  it("accepts base58 pubkeys", () => {
    expect(isPlausibleMarketId("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", false)).toBe(true);
    expect(isPlausibleMarketId("7hZ95hAUq6Zr9ZQJvKz3cWZ8d1kUe2nNfPq3oTzkXyW", false)).toBe(true);
  });
  it("rejects junk, non-base58 chars and wrong lengths", () => {
    for (const id of ["nope", "", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "abc", "x".repeat(60), "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T/x"]) {
      expect(isPlausibleMarketId(id, false)).toBe(false);
    }
  });
  it("fixture slugs only where fixtures are allowed (localnet)", () => {
    expect(isPlausibleMarketId("fixture-aapl-230-oct16", true)).toBe(true);
    expect(isPlausibleMarketId("fixture-aapl-230-oct16", false)).toBe(false);
  });
});

describe("middleware", () => {
  const req = (p: string) => new NextRequest(new URL(`http://localhost:3000${p}`));
  it("rewrites an implausible market id to the 404 route", () => {
    const res = middleware(req("/markets/nope"));
    expect(res?.headers.get("x-middleware-rewrite")).toMatch(/\/404-market$/);
  });
  it("passes real-looking ids and other routes through", () => {
    expect(middleware(req("/markets/4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T"))?.headers.get("x-middleware-rewrite")).toBeFalsy();
    expect(middleware(req("/markets"))?.headers.get("x-middleware-rewrite")).toBeFalsy();
  });
});
