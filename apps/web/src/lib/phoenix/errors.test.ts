import { describe, expect, it } from "vitest";
import { explainPlaceError, isPhoenixMarketPausedError, PHOENIX_MARKET_PAUSED_MESSAGE } from "./errors";

const sim = (hex: string, ix = 5) =>
  `Simulation failed. Message: Transaction simulation failed: Error processing Instruction ${ix}: custom program error: 0x${hex}. Logs: [...]`;

describe("explainPlaceError (D-024 / DLV-070)", () => {
  it("Phoenix NewOrderError on a market order → no-fill copy with size + worst price", () => {
    const r = explainPlaceError(sim("f"), { intent: "buy-no", orderType: "market", size: 7, worstPrice: 0.52 });
    expect(r?.reason).toBe("no-fill");
    expect(r?.message).toBe(
      "No fill: the book doesn't have 7 No at 0.52 or better. Nothing was traded — try a smaller size or a Limit order.",
    );
  });
  it("same Phoenix code on a limit order is not reinterpreted", () => {
    expect(explainPlaceError(sim("f"), { intent: "buy-yes", orderType: "limit", size: 1 })).toBeNull();
  });
  it("Meridian Paused / MarketNotOpen map to plain copy", () => {
    expect(explainPlaceError(sim("1770", 4), { intent: "buy-no", orderType: "market", size: 1 })?.message).toMatch(/paused/i);
    expect(explainPlaceError(sim("1771", 4), { intent: "buy-no", orderType: "market", size: 1 })?.message).toMatch(/no longer open/i);
  });
  it("other Meridian codes fall back to the IDL message", () => {
    expect(explainPlaceError(sim("1773"), { intent: "buy-no", orderType: "market", size: 1 })).toEqual({
      reason: "program-error",
      message: "Expiry not reached",
    });
  });
  it("non-custom errors (e.g. blockhash) → null (caller keeps raw message)", () => {
    expect(explainPlaceError("Blockhash not found", { intent: "buy-yes", orderType: "market", size: 1 })).toBeNull();
    expect(explainPlaceError(sim("1"), { intent: "sell-no", orderType: "market", size: 1 })).toBeNull();
  });
});

/**
 * Review gap from !73: books are paused at expiry (PSM ChangeMarketStatus(Paused)). Phoenix then refuses
 * new orders with ProgramError::InvalidAccountData and one of these program logs (phoenix-v1
 * phoenix_checkers.rs / new_order.rs — the same lines the opt-in localnet PSM test asserts).
 */
const pausedSim = (log: string, ix = 3) =>
  `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction ${ix}: invalid account data for instruction. \nLogs: \n[\n  "Program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY invoke [1]",\n  "Program log: ${log}",\n  "Program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY failed: invalid account data for instruction"\n]. \nCatch the \`SendTransactionError\` and call \`getLogs()\` on it for full details.`;

describe("Phoenix paused book → cancel/withdraw-only copy (!73 gap)", () => {
  it("exact ticket copy", () => {
    expect(PHOENIX_MARKET_PAUSED_MESSAGE).toBe("Market paused, cancel or withdraw only");
  });
  it.each([
    "FOK and IOC orders are not allowed, market status is Paused",
    "Post only order is not allowed, market status is Paused",
    "Market is not active, market status is Paused",
  ])("place/cross refused: %s", (log) => {
    for (const orderType of ["market", "limit", "post-only"]) {
      for (const intent of ["buy-yes", "sell-yes", "buy-no", "sell-no"] as const) {
        expect(explainPlaceError(pausedSim(log), { intent, orderType, size: 3, worstPrice: 0.6 })).toEqual({
          reason: "market-paused",
          message: PHOENIX_MARKET_PAUSED_MESSAGE,
        });
      }
    }
  });
  it("the Phoenix log is enough on its own (wallets that drop the simulation wrapper)", () => {
    expect(isPhoenixMarketPausedError("Program log: Post only order is not allowed, market status is Paused")).toBe(true);
  });
  it("other statuses / unrelated InvalidAccountData are not called paused", () => {
    expect(isPhoenixMarketPausedError(pausedSim("Post only order is not allowed, market status is Closed"))).toBe(false);
    expect(isPhoenixMarketPausedError(pausedSim("FOK and IOC orders are not allowed, market status is PostOnly"))).toBe(false);
    expect(isPhoenixMarketPausedError("Transaction simulation failed: Error processing Instruction 2: invalid account data for instruction")).toBe(false);
    expect(explainPlaceError(pausedSim("Post only order is not allowed, market status is Closed"), { intent: "buy-yes", orderType: "limit", size: 1 })).toBeNull();
  });
  it("Meridian's own Paused (0x1770, admin pause) keeps its copy", () => {
    expect(explainPlaceError(sim("1770", 4), { intent: "buy-no", orderType: "market", size: 1 })?.reason).toBe("program-error");
  });
});
