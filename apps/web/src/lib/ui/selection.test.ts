import { describe, expect, it } from "vitest";
import {
  isActivationKey,
  isNavActive,
  lastViewedMarket,
  LAST_VIEWED_MARKET_KEY,
  nextTabIndex,
  rememberViewedMarket,
  toggleSelection,
  type KeyValueStore,
} from "./selection";

describe("isNavActive", () => {
  it("matches exact route and sub-routes", () => {
    expect(isNavActive("/markets", "/markets")).toBe(true);
    expect(isNavActive("/markets/abc123", "/markets")).toBe(true);
    expect(isNavActive("/portfolio", "/markets")).toBe(false);
  });
  it("does not match prefix-only siblings", () => {
    expect(isNavActive("/marketsx", "/markets")).toBe(false);
    expect(isNavActive("/history-old", "/history")).toBe(false);
  });
  it("treats / as exact only", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/markets", "/")).toBe(false);
  });
  it("is false for missing pathname", () => {
    expect(isNavActive(null, "/markets")).toBe(false);
    expect(isNavActive(undefined, "/markets")).toBe(false);
  });
});

describe("toggleSelection", () => {
  it("selects, switches, and clears on same id", () => {
    let s: string | null = null;
    s = toggleSelection(s, "a");
    expect(s).toBe("a");
    s = toggleSelection(s, "b");
    expect(s).toBe("b");
    s = toggleSelection(s, "b");
    expect(s).toBeNull();
  });
});

describe("nextTabIndex", () => {
  it("wraps with arrows", () => {
    expect(nextTabIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextTabIndex(1, "ArrowDown", 3)).toBe(2);
    expect(nextTabIndex(1, "ArrowUp", 3)).toBe(0);
  });
  it("supports Home/End", () => {
    expect(nextTabIndex(1, "Home", 4)).toBe(0);
    expect(nextTabIndex(1, "End", 4)).toBe(3);
  });
  it("ignores other keys and empty lists", () => {
    expect(nextTabIndex(0, "a", 3)).toBeNull();
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("isActivationKey", () => {
  it("accepts Enter and Space only", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
    expect(isActivationKey("Tab")).toBe(false);
  });
});

describe("last viewed market", () => {
  const mem = (): KeyValueStore & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };
  it("round-trips through the store", () => {
    const s = mem();
    expect(lastViewedMarket(s)).toBeNull();
    rememberViewedMarket("M1", s);
    expect(s.data[LAST_VIEWED_MARKET_KEY]).toBe("M1");
    expect(lastViewedMarket(s)).toBe("M1");
  });
  it("ignores empty ids and missing storage", () => {
    const s = mem();
    rememberViewedMarket("", s);
    expect(lastViewedMarket(s)).toBeNull();
    expect(() => rememberViewedMarket("M1", null)).not.toThrow();
    expect(lastViewedMarket(null)).toBeNull();
  });
  it("swallows storage errors", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => rememberViewedMarket("M1", broken)).not.toThrow();
    expect(lastViewedMarket(broken)).toBeNull();
  });
});
