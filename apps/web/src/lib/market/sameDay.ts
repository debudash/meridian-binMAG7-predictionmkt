/**
 * DLV-118 (SPEC §1 / §3.3): same-day 0DTE = a market whose expiry is 16:00 America/New_York on the current ET day.
 * Mirrors apps/automation/src/marketDay.ts (expiry rule); pure, unit-tested in sameDay.test.ts.
 * The web clock is chain/wall time (useChainClock); it does not read the localnet SimClock.
 */
import type { MarketView } from "./types";

const ET = "America/New_York";

function etParts(unixSec: number): { dateKey: string; hour: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(unixSec * 1000))
      .map((x) => [x.type, x.value]),
  );
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) === 24 ? 0 : Number(p.hour), minute: Number(p.minute) };
}

/** 16:00 ET (EDT = UTC-4, EST = UTC-5) on the ET calendar day of `nowSec`. */
export function etCloseTsFor(nowSec: number): number {
  const { dateKey } = etParts(nowSec);
  const [y, mo, d] = dateKey.split("-").map(Number);
  for (const off of [4, 5]) {
    const t = Math.floor(Date.UTC(y, mo - 1, d, 16 + off, 0, 0) / 1000);
    const w = etParts(t);
    if (w.dateKey === dateKey && w.hour === 16 && w.minute === 0) return t;
  }
  throw new Error(`no 16:00 ET on ${dateKey}`);
}

export function isTodaysClose(m: Pick<MarketView, "tradingCloseTs">, nowSec: number): boolean {
  return m.tradingCloseTs === etCloseTsFor(nowSec);
}

export interface SameDayView<T> {
  visible: T[];
  /** markets hidden because they don't expire at today's close (0 when showing all) */
  hiddenOther: number;
  /** ids of listed markets that are NOT today's close (marked in the UI) */
  otherIds: Set<string>;
  /** today = only today's; all = toggle on; none-today = nothing expires today, everything shown with a notice */
  mode: "today" | "all" | "none-today";
}

export function sameDayView<T extends Pick<MarketView, "marketId" | "tradingCloseTs">>(
  markets: T[],
  nowSec: number,
  opts: { showOther: boolean },
): SameDayView<T> {
  const close = etCloseTsFor(nowSec);
  const today = markets.filter((m) => m.tradingCloseTs === close);
  const otherIds = new Set(markets.filter((m) => m.tradingCloseTs !== close).map((m) => m.marketId));
  if (today.length === 0) return { visible: markets, hiddenOther: 0, otherIds, mode: "none-today" };
  if (opts.showOther) return { visible: markets, hiddenOther: 0, otherIds, mode: "all" };
  return { visible: today, hiddenOther: markets.length - today.length, otherIds, mode: "today" };
}
