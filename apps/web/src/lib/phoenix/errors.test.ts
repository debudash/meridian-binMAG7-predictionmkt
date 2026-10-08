import { describe, expect, it } from "vitest";
import { explainPlaceError } from "./errors";

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
