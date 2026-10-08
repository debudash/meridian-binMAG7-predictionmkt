/**
 * Track A smoke (6d04b00): a wallet holding both Yes and No in a market only saw `You: Yes 10`
 * on the market card. Spec copy (docs/ui/02-markets.md) is "You: Yes 40" / "You: No 25";
 * the both-sides case shows both quantities, amber like the "Both sides held" chip (04-portfolio).
 */
import { describe, expect, it } from "vitest";
import { positionBadge } from "./positionBadge";

describe("positionBadge", () => {
  it("not connected → no badge", () => {
    expect(positionBadge({ connected: false, yesQty: 10, noQty: 0, lotSize: 1 })).toBeNull();
  });
  it("flat → no badge", () => {
    expect(positionBadge({ connected: true, yesQty: 0, noQty: 0, lotSize: 1 })).toBeNull();
  });
  it("Yes only", () => {
    expect(positionBadge({ connected: true, yesQty: 40, noQty: 0, lotSize: 1 })).toEqual({ text: "You: Yes 40", tone: "yes" });
  });
  it("No only", () => {
    expect(positionBadge({ connected: true, yesQty: 0, noQty: 25, lotSize: 1 })).toEqual({ text: "You: No 25", tone: "no" });
  });
  it("both sides → both quantities, amber", () => {
    expect(positionBadge({ connected: true, yesQty: 10, noQty: 10, lotSize: 1 })).toEqual({
      text: "You: Yes 10 · No 10",
      tone: "both",
    });
  });
  it("dust below one lot on a side is ignored", () => {
    expect(positionBadge({ connected: true, yesQty: 10, noQty: 0.5, lotSize: 1 })).toEqual({ text: "You: Yes 10", tone: "yes" });
    expect(positionBadge({ connected: true, yesQty: 0.5, noQty: 3, lotSize: 1 })).toEqual({ text: "You: No 3", tone: "no" });
  });
  it("missing lot size defaults to 1", () => {
    expect(positionBadge({ connected: true, yesQty: 1, noQty: 1 })).toEqual({ text: "You: Yes 1 · No 1", tone: "both" });
  });
});
