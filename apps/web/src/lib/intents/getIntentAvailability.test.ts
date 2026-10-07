import { describe, expect, it } from "vitest";
import { getIntentAvailability, getExposure } from "./getIntentAvailability";
import type {
  MarketStateSnapshot,
  OpenOrdersSnapshot,
  PendingTxSnapshot,
  PositionSnapshot,
} from "./types";

const openMarket: MarketStateSnapshot = { lifecycle: "open", lotSize: 1 };
const noOrders: OpenOrdersSnapshot = {
  openBuyYesQty: 0,
  openBuyNoQty: 0,
};
const noPending: PendingTxSnapshot = { pendingTradeCount: 0 };

function avail(
  position: PositionSnapshot,
  orders: OpenOrdersSnapshot = noOrders,
  pending: PendingTxSnapshot = noPending,
  market: MarketStateSnapshot = openMarket,
) {
  return getIntentAvailability(position, orders, pending, market);
}

describe("getIntentAvailability §2.1 matrix", () => {
  it("Flat (0/0): Buy Yes ✅ Sell Yes ⛔ Buy No ✅ Sell No ⛔", () => {
    const a = avail({ yesQty: 0, noQty: 0 });
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["sell-yes"].enabled).toBe(false);
    expect(a["sell-yes"].reason).toBe("nothing-to-sell");
    expect(a["buy-no"].enabled).toBe(true);
    expect(a["sell-no"].enabled).toBe(false);
    expect(a["sell-no"].reason).toBe("nothing-to-sell");
  });

  it("Yes > 0: Buy Yes ✅ Sell Yes ✅ Buy No ⛔ Sell No ⛔", () => {
    const a = avail({ yesQty: 40, noQty: 0 });
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["sell-yes"].enabled).toBe(true);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].reason).toBe("blocked");
    expect(a["buy-no"].copy).toContain("40 Yes");
    expect(a["buy-no"].cta?.intent).toBe("sell-yes");
    expect(a["sell-no"].enabled).toBe(false);
  });

  it("No > 0: Buy Yes ⛔ Sell Yes ⛔ Buy No ✅ Sell No ✅", () => {
    const a = avail({ yesQty: 0, noQty: 25 });
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-yes"].reason).toBe("blocked");
    expect(a["buy-yes"].copy).toContain("25 No");
    expect(a["sell-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(true);
    expect(a["sell-no"].enabled).toBe(true);
  });

  it("Both > 0 (legacy): Buy ⛔ Sell ✅ both sides", () => {
    const a = avail({ yesQty: 10, noQty: 5 });
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["sell-yes"].enabled).toBe(true);
    expect(a["sell-no"].enabled).toBe(true);
    expect(a["buy-yes"].copy).toMatch(/both Yes and No/i);
  });
});

describe("getIntentAvailability §2.4 edge cases", () => {
  it("E1 Flat → open: both buys enabled", () => {
    const a = avail({ yesQty: 0, noQty: 0 });
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["buy-no"].enabled).toBe(true);
  });

  it("E3 Partial close: selling part of Yes keeps Buy No blocked", () => {
    const a = avail({ yesQty: 10, noQty: 0 });
    expect(a["buy-no"].enabled).toBe(false);
  });

  it("E4 Dust below lotSize treated as 0 for blocking", () => {
    const a = avail(
      { yesQty: 0.3, noQty: 0 },
      noOrders,
      noPending,
      { lifecycle: "open", lotSize: 1 },
    );
    expect(a["buy-no"].enabled).toBe(true);
    expect(a["sell-yes"].enabled).toBe(true); // still can attempt sell of dust
  });

  it("E5 Resting Sell Yes for full size does NOT unblock Buy No", () => {
    // yesQty still > 0 even if locked in asks
    const a = avail({
      yesQty: 40,
      noQty: 0,
      yesLockedInAsks: 40,
    });
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["sell-yes"].enabled).toBe(false); // nothing available to sell
  });

  it("E9 Market closed: all intents disabled", () => {
    const a = avail(
      { yesQty: 40, noQty: 0 },
      noOrders,
      noPending,
      { lifecycle: "settled" },
    );
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["sell-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["sell-no"].enabled).toBe(false);
    expect(a["buy-yes"].reason).toBe("market-closed");
  });

  it("E9 Closed awaiting result disables trading", () => {
    const a = avail(
      { yesQty: 0, noQty: 0 },
      noOrders,
      noPending,
      { lifecycle: "closed" },
    );
    expect(Object.values(a).every((x) => !x.enabled)).toBe(true);
  });

  it("E10 Sell size respects locked asks", () => {
    const a = avail({ yesQty: 40, noQty: 0, yesLockedInAsks: 12 });
    expect(a["sell-yes"].enabled).toBe(true);
  });

  it("Open Buy Yes orders block Buy No (§2.2)", () => {
    const a = avail({ yesQty: 0, noQty: 0 }, {
      openBuyYesQty: 15,
      openBuyNoQty: 0,
    });
    expect(a["buy-no"].enabled).toBe(false);
    expect(a["buy-no"].copy).toContain("open Buy Yes");
    expect(a["buy-yes"].enabled).toBe(true);
  });

  it("Open Buy No orders block Buy Yes", () => {
    const a = avail({ yesQty: 0, noQty: 0 }, {
      openBuyYesQty: 0,
      openBuyNoQty: 10,
    });
    expect(a["buy-yes"].enabled).toBe(false);
    expect(a["buy-no"].enabled).toBe(true);
  });

  it("Pending txs disable all intents", () => {
    const a = avail(
      { yesQty: 0, noQty: 0 },
      noOrders,
      { pendingTradeCount: 1 },
    );
    expect(Object.values(a).every((x) => !x.enabled)).toBe(true);
    expect(a["buy-yes"].reason).toBe("pending");
  });

  it("Closing-soon still allows trading", () => {
    const a = avail(
      { yesQty: 0, noQty: 0 },
      noOrders,
      noPending,
      { lifecycle: "closing-soon" },
    );
    expect(a["buy-yes"].enabled).toBe(true);
    expect(a["buy-no"].enabled).toBe(true);
  });
});

describe("getExposure", () => {
  it("sums held + open buys", () => {
    const e = getExposure(
      { yesQty: 10, noQty: 0 },
      { openBuyYesQty: 5, openBuyNoQty: 0 },
    );
    expect(e.yesExposure).toBe(15);
    expect(e.noExposure).toBe(0);
  });
});
