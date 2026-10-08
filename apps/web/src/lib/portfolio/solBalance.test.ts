import { describe, expect, it } from "vitest";
import { formatSol, LOW_SOL_LAMPORTS, solIsLow } from "./solBalance";

describe("Portfolio SOL (network fees) tile — docs/ui/04 'available USDC/SOL'", () => {
  it("formats lamports as SOL with 4 decimals", () => {
    expect(formatSol(500_000_000)).toBe("0.5000 SOL");
    expect(formatSol(1_234_567_890)).toBe("1.2346 SOL");
    expect(formatSol(0)).toBe("0.0000 SOL");
  });
  it("shows a dash when the balance has not loaded", () => {
    expect(formatSol(null)).toBe("—");
  });
  it("flags a balance too small for network fees (docs/ui/07 'No SOL')", () => {
    expect(solIsLow(0)).toBe(true);
    expect(solIsLow(LOW_SOL_LAMPORTS - 1)).toBe(true);
    expect(solIsLow(LOW_SOL_LAMPORTS)).toBe(false);
    expect(solIsLow(null)).toBe(false);
  });
});
