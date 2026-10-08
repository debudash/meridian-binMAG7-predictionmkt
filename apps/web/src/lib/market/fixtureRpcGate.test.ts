/**
 * M2 (Reviewers, !59): the `custom` cluster label turned fixtures on whatever RPC it pointed at
 * (devnet / mainnet / private). Fixtures — sample markets, fixture book, fixture slugs in the
 * middleware, demo portfolio — now need a fixture-style cluster label AND a loopback RPC.
 */
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isFixtureCluster, isLoopbackRpcUrl } from "./marketIdRoute";
import { fixturesAllowed } from "@/lib/solana/config";
import { demoAccountAllowed, demoMarketAllowed } from "@/lib/portfolio/demoMode";
import { middleware } from "@/middleware";

const DEVNET = "https://api.devnet.solana.com";
const LOCAL = "http://127.0.0.1:8899";
const saved = { c: process.env.NEXT_PUBLIC_SOLANA_CLUSTER, r: process.env.NEXT_PUBLIC_SOLANA_RPC_URL };
function setEnv(cluster: string | undefined, rpc: string | undefined) {
  if (cluster === undefined) delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  else process.env.NEXT_PUBLIC_SOLANA_CLUSTER = cluster;
  if (rpc === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = rpc;
}
afterEach(() => setEnv(saved.c, saved.r));

describe("isLoopbackRpcUrl", () => {
  it("accepts 127.0.0.1 / localhost / [::1] over http(s), any port", () => {
    for (const u of ["http://127.0.0.1:8899", "http://localhost:8899", "http://[::1]:8899", "https://localhost", "http://127.0.0.1/"]) {
      expect(isLoopbackRpcUrl(u), u).toBe(true);
    }
  });
  it("rejects public / private hosts and look-alikes", () => {
    for (const u of [DEVNET, "https://api.mainnet-beta.solana.com", "http://10.0.0.5:8899", "http://127.0.0.1.evil.com:8899", "http://localhost.evil.com", "http://localhost@evil.com", "ws://127.0.0.1:8900", "", undefined]) {
      expect(isLoopbackRpcUrl(u as string | undefined), String(u)).toBe(false);
    }
  });
});

describe("fixture gate requires a loopback RPC", () => {
  it("custom + devnet RPC → no fixtures (the M2 case)", () => {
    expect(isFixtureCluster("custom", DEVNET)).toBe(false);
    expect(fixturesAllowed("custom", DEVNET)).toBe(false);
  });
  it("localnet / localhost with a non-loopback or missing RPC → no fixtures", () => {
    expect(fixturesAllowed("localnet", DEVNET)).toBe(false);
    expect(fixturesAllowed("localhost", "https://api.mainnet-beta.solana.com")).toBe(false);
    expect(fixturesAllowed("localnet", undefined)).toBe(false);
  });
  it("fixture-style label + loopback RPC → fixtures (local dev unchanged)", () => {
    for (const c of ["localnet", "localhost", "custom"]) expect(fixturesAllowed(c, LOCAL)).toBe(true);
  });
  it("real clusters never allow fixtures, even on loopback", () => {
    for (const c of ["devnet", "testnet", "mainnet-beta", ""]) expect(fixturesAllowed(c, LOCAL)).toBe(false);
  });
  it("defaults read the env: custom + devnet RPC → off; localnet + loopback → on", () => {
    setEnv("custom", DEVNET);
    expect(fixturesAllowed()).toBe(false);
    setEnv("localnet", LOCAL);
    expect(fixturesAllowed()).toBe(true);
  });
  it("demo portfolio / demo market follow the same gate", () => {
    setEnv("custom", DEVNET);
    expect(demoAccountAllowed({ usedFixtures: true })).toBe(false);
    expect(demoMarketAllowed("fixture-aapl-230-oct16")).toBe(false);
    setEnv("localnet", LOCAL);
    expect(demoAccountAllowed({ usedFixtures: true })).toBe(true);
    expect(demoMarketAllowed("fixture-aapl-230-oct16")).toBe(true);
  });
});

describe("middleware: fixture slugs", () => {
  const req = (p: string) => new NextRequest(new URL(`http://localhost:3000${p}`));
  it("custom + devnet RPC → /markets/fixture-* is a 404", () => {
    setEnv("custom", DEVNET);
    expect(middleware(req("/markets/fixture-aapl-230-oct16"))?.headers.get("x-middleware-rewrite")).toMatch(/\/404-market$/);
  });
  it("localnet + loopback RPC → fixture slug passes through", () => {
    setEnv("localnet", LOCAL);
    expect(middleware(req("/markets/fixture-aapl-230-oct16"))?.headers.get("x-middleware-rewrite")).toBeFalsy();
  });
});
