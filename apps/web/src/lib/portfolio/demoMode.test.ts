/**
 * DLV-088 — demo portfolio/history/redeem data is only ever shown in explicit localnet fixture
 * mode (the app is showing fixture markets on a localnet-style cluster). Never on devnet/mainnet,
 * and never for real markets on localnet.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { demoAccountAllowed, demoMarketAllowed, isFixtureMarketId } from "./demoMode";

// M2: fixtures need a loopback RPC as well as a localnet-style label — these cases model local dev.
const savedRpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
beforeAll(() => {
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
});
afterAll(() => {
  if (savedRpcUrl === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  else process.env.NEXT_PUBLIC_SOLANA_RPC_URL = savedRpcUrl;
});

describe("demo mode gating", () => {
  it("fixture ids", () => {
    expect(isFixtureMarketId("fixture-aapl-230-oct16")).toBe(true);
    expect(isFixtureMarketId("7hZ95hAUq6Zr9ZQJvKz3cWZ8d1kUe2nNfPq3oTzkXyW")).toBe(false);
  });

  it("account-wide demo (Portfolio / History / Header dot): localnet AND fixture markets in use", () => {
    expect(demoAccountAllowed({ cluster: "localnet", usedFixtures: true })).toBe(true);
    expect(demoAccountAllowed({ cluster: "localnet", usedFixtures: false })).toBe(false);
    for (const c of ["devnet", "testnet", "mainnet-beta", "mainnet"]) {
      expect(demoAccountAllowed({ cluster: c, usedFixtures: true })).toBe(false);
    }
  });

  it("per-market demo (availability): localnet AND a fixture market", () => {
    expect(demoMarketAllowed("fixture-msft-420", "localnet")).toBe(true);
    expect(demoMarketAllowed("fixture-msft-420", "devnet")).toBe(false);
    expect(demoMarketAllowed("7hZ95hAUq6Zr9ZQJvKz3cWZ8d1kUe2nNfPq3oTzkXyW", "localnet")).toBe(false);
  });
});
