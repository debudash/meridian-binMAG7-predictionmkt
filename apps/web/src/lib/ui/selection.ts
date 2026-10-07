/**
 * Shared selection / active-state helpers (D-022, docs/ui/README "Selection & active states").
 * Pure functions so the rules are unit-tested; components only wire them to ARIA + CSS.
 */

/** Primary-nav match: exact route or any sub-route (`/markets/abc` → Markets). */
export function isNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Single-select toggle: clicking the selected id clears it, another id replaces it. */
export function toggleSelection<T>(current: T | null, id: T): T | null {
  return current === id ? null : id;
}

/**
 * Roving focus for tablists / segmented controls (WAI-ARIA tabs pattern):
 * ←/↑ previous, →/↓ next (wrapping), Home first, End last. Returns null for other keys.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Enter / Space activate a focusable row (role=row|option) like a button. */
export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/** Minimal storage surface so tests can inject a fake (sessionStorage in the app). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LAST_VIEWED_MARKET_KEY = "meridian:lastViewedMarket";

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Remember the market the user last opened, so lists can mark it "Last viewed". */
export function rememberViewedMarket(marketId: string, store = defaultStore()): void {
  if (!store || !marketId) return;
  try {
    store.setItem(LAST_VIEWED_MARKET_KEY, marketId);
  } catch {
    /* storage full / blocked — cosmetic only */
  }
}

export function lastViewedMarket(store = defaultStore()): string | null {
  if (!store) return null;
  try {
    return store.getItem(LAST_VIEWED_MARKET_KEY);
  } catch {
    return null;
  }
}
