/**
 * DLV-118 (SPEC §1 / §3.3): the Markets list shows the same-day 0DTE markets — those expiring at the current ET day's
 * 16:00 close. Other expiries (older fixtures, week-out localnet markets) are hidden behind a toggle and marked; when no
 * market expires today (weekend, fixtures) everything is shown with a notice instead of an empty page.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { etCloseTsFor, isTodaysClose, sameDayView } from "./sameDay";

const utc = (y: number, mo: number, d: number, h: number, mi = 0) => Math.floor(Date.UTC(y, mo - 1, d, h, mi) / 1000);
const CLOSE_1008 = 1791489600; // 2026-10-08 16:00 EDT
const m = (marketId: string, tradingCloseTs: number) => ({ marketId, tradingCloseTs }) as any;

describe("DLV-118 same-day close (web)", () => {
  it("today's 16:00 ET close for the ET day of now, DST-aware", () => {
    expect(etCloseTsFor(utc(2026, 10, 8, 18, 47))).toBe(CLOSE_1008);
    expect(etCloseTsFor(utc(2026, 10, 9, 1))).toBe(CLOSE_1008); // 21:00 ET Oct 8 (UTC already Oct 9)
    expect(etCloseTsFor(utc(2026, 11, 2, 15))).toBe(utc(2026, 11, 2, 21)); // EST
    expect(etCloseTsFor(utc(2026, 3, 9, 14))).toBe(utc(2026, 3, 9, 20)); // EDT
  });

  it("isTodaysClose: exact expiry match only (a week-out or yesterday market is not today's 0DTE)", () => {
    const now = utc(2026, 10, 8, 18, 47);
    expect(isTodaysClose(m("a", CLOSE_1008), now)).toBe(true);
    expect(isTodaysClose(m("b", CLOSE_1008 + 6 * 86400), now)).toBe(false);
    expect(isTodaysClose(m("c", CLOSE_1008 - 86400), now)).toBe(false);
    expect(isTodaysClose(m("d", CLOSE_1008 + 60), now)).toBe(false);
  });

  it("sameDayView: default shows only today's markets and counts the hidden ones", () => {
    const list = [m("today1", CLOSE_1008), m("week", CLOSE_1008 + 6 * 86400), m("today2", CLOSE_1008)];
    const v = sameDayView(list, utc(2026, 10, 8, 18, 47), { showOther: false });
    expect(v.visible.map((x: any) => x.marketId)).toEqual(["today1", "today2"]);
    expect(v.hiddenOther).toBe(1);
    expect(v.mode).toBe("today");
    expect(v.otherIds.has("week")).toBe(true);
  });

  it("sameDayView: showOther lists everything and marks the non-today ones", () => {
    const list = [m("today1", CLOSE_1008), m("week", CLOSE_1008 + 6 * 86400)];
    const v = sameDayView(list, utc(2026, 10, 8, 18, 47), { showOther: true });
    expect(v.visible.map((x: any) => x.marketId)).toEqual(["today1", "week"]);
    expect(v.hiddenOther).toBe(0);
    expect(v.mode).toBe("all");
    expect([...v.otherIds]).toEqual(["week"]);
  });

  it("sameDayView: no market expires today (weekend / fixtures) → show all with a notice, never an empty page", () => {
    const list = [m("week", CLOSE_1008 + 6 * 86400)];
    const v = sameDayView(list, utc(2026, 10, 10, 15), { showOther: false });
    expect(v.visible.map((x: any) => x.marketId)).toEqual(["week"]);
    expect(v.mode).toBe("none-today");
  });

  it("MarketsClient applies the same-day view (not on the settled tab) with a toggle + marker", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../app/markets/MarketsClient.tsx"), "utf8");
    expect(src).toMatch(/sameDayView\(/);
    expect(src).toMatch(/data-testid="same-day-notice"/);
    expect(src).toMatch(/data-testid="same-day-toggle"/);
    expect(src).toMatch(/status === "settled"/);
    expect(src).toMatch(/Not today's close/);
  });
});
