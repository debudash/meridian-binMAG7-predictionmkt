/**
 * DLV-089 — no favicon 404 on every page, and an unknown market is a real HTTP 404.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const indexer = vi.hoisted(() => ({ getMarket: vi.fn() }));
vi.mock("@/lib/indexer", () => indexer);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

describe("favicon", () => {
  it("ships an app icon (Next serves /icon.svg and links it in <head>)", () => {
    const icon = path.join(__dirname, "icon.svg");
    expect(fs.existsSync(icon)).toBe(true);
    expect(fs.readFileSync(icon, "utf8")).toMatch(/^<svg[\s>]/);
  });

  it("rewrites the browser's implicit /favicon.ico request to the icon", async () => {
    // @ts-expect-error — plain .mjs config has no type declarations
    const cfg = (await import("../../next.config.mjs")).default as {
      rewrites?: () => Promise<{ source: string; destination: string }[]>;
    };
    expect(typeof cfg.rewrites).toBe("function");
    expect(await cfg.rewrites!()).toContainEqual({ source: "/favicon.ico", destination: "/icon.svg" });
  });
});

describe("unknown market → 404", () => {
  it("generateMetadata calls notFound() before streaming starts (so the status is 404, not 200)", async () => {
    indexer.getMarket.mockResolvedValue({ market: null, source: "rpc-gpa", usedFixtures: false });
    const { generateMetadata } = await import("./markets/[marketId]/page");
    await expect(generateMetadata({ params: { marketId: "nope" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("RPC outage is NOT a 404 — metadata falls back so the page can render 'Market unavailable'", async () => {
    indexer.getMarket.mockResolvedValue({ market: null, source: "unavailable", usedFixtures: false, error: "down" });
    const { generateMetadata } = await import("./markets/[marketId]/page");
    await expect(generateMetadata({ params: { marketId: "x" } })).resolves.toMatchObject({ title: "Market · Meridian" });
  });

  it("known market → titled metadata", async () => {
    indexer.getMarket.mockResolvedValue({
      market: { underlyingSymbol: "NVDA", question: "NVDA ≥ $135?" },
      source: "rpc-gpa",
      usedFixtures: false,
    });
    const { generateMetadata } = await import("./markets/[marketId]/page");
    await expect(generateMetadata({ params: { marketId: "y" } })).resolves.toMatchObject({ title: "NVDA · Meridian" });
  });
});
