/**
 * DLV-090 — chain-read failures must be logged (never silently swallowed), with the scope,
 * cluster and cause, and de-duplicated so a 4 s poll doesn't flood the console.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logChainReadError, isMissingAccountError, __resetChainReadLogForTests } from "./chainRead";

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  __resetChainReadLogForTests();
  spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => spy.mockRestore());

describe("logChainReadError", () => {
  it("logs scope, cluster and the error message", () => {
    logChainReadError("rpc.listMarkets", new Error("429 Too Many Requests"), { cluster: "devnet" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("[chain-read]");
    expect(line).toContain("rpc.listMarkets");
    expect(line).toContain("429 Too Many Requests");
    expect(line).toContain("devnet");
  });

  it("stringifies non-Error throwables", () => {
    logChainReadError("phoenix.book", "socket hang up");
    expect(String(spy.mock.calls[0][0])).toContain("socket hang up");
  });

  it("de-duplicates the same scope+message inside the window, then logs again after it", () => {
    const t0 = 1_000_000;
    logChainReadError("wallet.positions", new Error("fetch failed"), undefined, t0);
    logChainReadError("wallet.positions", new Error("fetch failed"), undefined, t0 + 5_000);
    expect(spy).toHaveBeenCalledTimes(1);
    logChainReadError("wallet.positions", new Error("other"), undefined, t0 + 6_000);
    expect(spy).toHaveBeenCalledTimes(2);
    logChainReadError("wallet.positions", new Error("fetch failed"), undefined, t0 + 61_000);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("isMissingAccountError", () => {
  it("recognises Anchor/web3 'account does not exist' (a real 404, not an RPC failure)", () => {
    expect(isMissingAccountError(new Error("Account does not exist or has no data 4Nd1mB…"))).toBe(true);
    expect(isMissingAccountError(new Error("Invalid public key input"))).toBe(true);
    expect(isMissingAccountError(new Error("failed to get info about account: fetch failed"))).toBe(false);
    expect(isMissingAccountError(new Error("429 Too Many Requests"))).toBe(false);
  });
});
