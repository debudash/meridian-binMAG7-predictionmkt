/**
 * Source guards for the ticket (node-only vitest, no DOM): M1 lot check before signing, L8 clamp,
 * L11 sweep line, L14 confirmation before success, M5 retry — wired, not just defined.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ticket = readFileSync(path.join(__dirname, "TradeTicket.tsx"), "utf8");
const trade = readFileSync(path.join(__dirname, "../../app/markets/[marketId]/TradeClient.tsx"), "utf8");
const actions = readFileSync(path.join(__dirname, "../portfolio/PhoenixActions.tsx"), "utf8");

describe("TradeTicket wiring", () => {
  it("M1: validates size against the lot, blocks submit and passes lotSize to placePhoenixOrder", () => {
    expect(ticket).toMatch(/lotSizeError\(size, lotSize\)/);
    expect(ticket).toMatch(/if \(sizeError\) \{/);
    expect(ticket).toMatch(/sizeError != null/);
    expect(ticket).toMatch(/\n\s+lotSize,\n\s+orderType: phoenixType/);
  });
  it("L8: market worst price goes through marketWorstPrice (no bare ± 0.02)", () => {
    expect(ticket).toMatch(/marketWorstPrice\(/);
    expect(ticket).not.toMatch(/price \+ \(isBuy \? 0\.02 : -0\.02\)/);
  });
  it("L11: sweep disclosed on the ticket and in the toast", () => {
    expect(ticket).toMatch(/sweepDisclosure\(seatFree\)/);
    expect(ticket).toMatch(/sweepDisclosure\(seatFree, "past"\)/);
    expect(trade).toMatch(/seatFree=\{/);
  });
  it("L14: success toast only after confirmSignature (ticket and Phoenix actions)", () => {
    expect(ticket).toMatch(/confirmSignature\(connection, result\.signature/);
    expect(ticket).toMatch(/toastForConfirm\(/);
    expect(actions).not.toMatch(/confirmTransaction\([^)]*\)\.catch\(\(\) => undefined\)/);
  });
  it("M5: failed first read keeps the ticket locked and offers a retry", () => {
    expect(trade).toMatch(/balancesError: account\.connected && !account\.position && account\.error != null/);
    expect(trade).toMatch(/onRetryBalances=\{account\.refresh\}/);
    expect(ticket).toMatch(/current\.reason === "balances-error" && onRetryBalances/);
  });
});
