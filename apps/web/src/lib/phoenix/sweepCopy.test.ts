/** L11 (Reviewers, !63): the auto-sweep is disclosed in one short line on the ticket and the toast. */
import { describe, expect, it } from "vitest";
import { sweepDisclosure } from "./sweepCopy";

describe("sweepDisclosure", () => {
  it("names what moves from the Phoenix account to the wallet", () => {
    expect(sweepDisclosure({ yesFree: 4, usdcFree: 2.4 })).toBe(
      "Also moves 4 Yes / 2.40 USDC from your Phoenix account to your wallet.",
    );
    expect(sweepDisclosure({ yesFree: 0, usdcFree: 1.5 })).toBe(
      "Also moves 1.50 USDC from your Phoenix account to your wallet.",
    );
    expect(sweepDisclosure({ yesFree: 3, usdcFree: 0 })).toBe(
      "Also moves 3 Yes from your Phoenix account to your wallet.",
    );
  });
  it("past tense for the toast", () => {
    expect(sweepDisclosure({ yesFree: 4, usdcFree: 2.4 }, "past")).toBe(
      "Also moved 4 Yes / 2.40 USDC from your Phoenix account to your wallet.",
    );
  });
  it("nothing free → no line", () => {
    expect(sweepDisclosure({ yesFree: 0, usdcFree: 0 })).toBeNull();
    expect(sweepDisclosure(null)).toBeNull();
    expect(sweepDisclosure(undefined)).toBeNull();
  });
});
