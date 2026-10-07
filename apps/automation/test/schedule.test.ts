import { expect } from "chai";
import {
  assertSettleAllowedCalendar,
  canSettleCalendar,
  getEtParts,
  isCreateWindow,
} from "../src/schedule";

/** Build a Date that formats to the given ET wall time (approximate via binary search). */
function dateAtEt(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 12, 0, 0);
  for (let deltaMin = -20 * 60; deltaMin <= 20 * 60; deltaMin++) {
    const d = new Date(utcGuess + deltaMin * 60_000);
    const p = getEtParts(d);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    ) {
      return d;
    }
  }
  throw new Error(`Could not resolve ET ${year}-${month}-${day} ${hour}:${minute}`);
}

describe("ET schedule gates", () => {
  it("rejects calendar settle before 16:00 ET", () => {
    const before = dateAtEt(2026, 10, 6, 15, 59);
    expect(canSettleCalendar(before, 16)).to.equal(false);
    expect(() => assertSettleAllowedCalendar(before, 16)).to.throw(/settle rejected/i);
  });

  it("allows calendar settle at and after 16:00 ET", () => {
    const at = dateAtEt(2026, 10, 6, 16, 0);
    const after = dateAtEt(2026, 10, 6, 16, 5);
    expect(canSettleCalendar(at, 16)).to.equal(true);
    expect(canSettleCalendar(after, 16)).to.equal(true);
    expect(() => assertSettleAllowedCalendar(at, 16)).to.not.throw();
  });

  it("create window is only CREATE_HOUR_ET", () => {
    const at8 = dateAtEt(2026, 10, 6, 8, 15);
    const at9 = dateAtEt(2026, 10, 6, 9, 0);
    expect(isCreateWindow(at8, 8)).to.equal(true);
    expect(isCreateWindow(at9, 8)).to.equal(false);
  });
});
