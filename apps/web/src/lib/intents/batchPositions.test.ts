import { describe, expect, it } from "vitest";
import {
  chunk,
  MAX_ACCOUNTS_PER_CALL,
  parsedTokenUiAmount,
  planPositionReads,
  positionsFromAccounts,
} from "./batchPositions";
import { getIntentAvailability } from "./getIntentAvailability";
import { shortBuyBlockedTitle } from "./shortCopy";

const ata = (mint: string) => `ata:${mint}`;
const tok = (uiAmount: number | null) => ({
  data: { parsed: { info: { tokenAmount: { uiAmount } } } },
});

describe("planPositionReads", () => {
  it("plans two ATAs per market in one flat key list", () => {
    const plan = planPositionReads(
      [
        { marketId: "A", yesMint: "yA", noMint: "nA" },
        { marketId: "B", yesMint: "yB", noMint: "nB" },
      ],
      ata,
    );
    expect(plan.keys).toEqual(["ata:yA", "ata:nA", "ata:yB", "ata:nB"]);
    expect(plan.requests).toEqual([
      { marketId: "A", yesIdx: 0, noIdx: 1 },
      { marketId: "B", yesIdx: 2, noIdx: 3 },
    ]);
  });
  it("skips markets without both mints and duplicate market ids", () => {
    const plan = planPositionReads(
      [
        { marketId: "A", yesMint: "yA" },
        { marketId: "B", yesMint: "yB", noMint: "nB" },
        { marketId: "B", yesMint: "yB", noMint: "nB" },
      ],
      ata,
    );
    expect(plan.requests.map((r) => r.marketId)).toEqual(["B"]);
    expect(plan.keys).toHaveLength(2);
  });
  it("dedupes shared ATAs", () => {
    const plan = planPositionReads(
      [
        { marketId: "A", yesMint: "y", noMint: "n" },
        { marketId: "B", yesMint: "y", noMint: "n2" },
      ],
      ata,
    );
    expect(plan.keys).toEqual(["ata:y", "ata:n", "ata:n2"]);
    expect(plan.requests[1]).toEqual({ marketId: "B", yesIdx: 0, noIdx: 2 });
  });
});

describe("chunk", () => {
  it("splits at the RPC limit (2 ATAs × 60 markets → 2 calls)", () => {
    const keys = Array.from({ length: 120 }, (_, i) => `k${i}`);
    const parts = chunk(keys);
    expect(parts.map((p) => p.length)).toEqual([MAX_ACCOUNTS_PER_CALL, 20]);
    expect(parts.flat()).toEqual(keys);
  });
  it("handles empty input and rejects bad size", () => {
    expect(chunk([])).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("positionsFromAccounts", () => {
  it("maps uiAmounts back per market; missing ATAs are 0", () => {
    const plan = planPositionReads(
      [
        { marketId: "NVDA", yesMint: "yN", noMint: "nN" },
        { marketId: "TSLA", yesMint: "yT", noMint: "nT" },
      ],
      ata,
    );
    const pos = positionsFromAccounts(plan, [tok(10), null, null, tok(10)]);
    expect(pos.get("NVDA")).toEqual({ yesQty: 10, noQty: 0 });
    expect(pos.get("TSLA")).toEqual({ yesQty: 0, noQty: 10 });
  });
  it("parsedTokenUiAmount tolerates junk", () => {
    expect(parsedTokenUiAmount(undefined)).toBe(0);
    expect(parsedTokenUiAmount({ data: Buffer.from([]) })).toBe(0);
    expect(parsedTokenUiAmount(tok(null))).toBe(0);
    expect(parsedTokenUiAmount(tok(2.5))).toBe(2.5);
  });
});

describe("shortBuyBlockedTitle (with the ticket's availability rules)", () => {
  const avail = (yesQty: number, noQty: number, open = { openBuyYesQty: 0, openBuyNoQty: 0 }) =>
    getIntentAvailability({ yesQty, noQty }, open, { pendingTradeCount: 0 }, { lifecycle: "open", lotSize: 1 });

  it("holding Yes blocks Buy No with a short title; Buy Yes stays open", () => {
    const a = avail(10, 0);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-yes"].enabled).toBe(true);
    expect(shortBuyBlockedTitle("no", a["buy-no"], { yesQty: 10, noQty: 0 })).toBe(
      "You hold Yes — sell it first",
    );
    expect(shortBuyBlockedTitle("yes", a["buy-yes"], { yesQty: 10, noQty: 0 })).toBeUndefined();
  });
  it("holding No blocks Buy Yes", () => {
    const a = avail(0, 10);
    expect(shortBuyBlockedTitle("yes", a["buy-yes"], { yesQty: 0, noQty: 10 })).toBe(
      "You hold No — sell it first",
    );
  });
  it("resting buys count as exposure", () => {
    const open = { openBuyYesQty: 5, openBuyNoQty: 0 };
    const a = avail(0, 0, open);
    expect(shortBuyBlockedTitle("no", a["buy-no"], { yesQty: 0, noQty: 0 }, open)).toBe(
      "Open Buy Yes orders — cancel them first",
    );
  });
  it("both sides held blocks both buys", () => {
    const a = avail(3, 4);
    expect(shortBuyBlockedTitle("yes", a["buy-yes"], { yesQty: 3, noQty: 4 })).toBe(
      "You hold Yes and No — sell one side first",
    );
  });
  it("flat wallet → nothing blocked", () => {
    const a = avail(0, 0);
    expect(a["buy-yes"].enabled && a["buy-no"].enabled).toBe(true);
  });
  it("closed market uses the closed copy", () => {
    const a = getIntentAvailability({ yesQty: 0, noQty: 0 }, { openBuyYesQty: 0, openBuyNoQty: 0 }, { pendingTradeCount: 0 }, { lifecycle: "closed" });
    expect(shortBuyBlockedTitle("yes", a["buy-yes"], { yesQty: 0, noQty: 0 })).toBe(
      "Trading is closed for this market.",
    );
  });
});
