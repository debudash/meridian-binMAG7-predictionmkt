import { describe, expect, it } from "vitest";
import { resolveClockNowSec } from "./clock";
import { getCountdown } from "./countdown";
import { buildFixtureMarkets } from "./fixtures";

describe("resolveClockNowSec (DLV-086 hydration-stable clock)", () => {
  it("uses the server render time before mount, regardless of client clock/skew", () => {
    expect(
      resolveClockNowSec({ mounted: false, serverNowSec: 1_000, clientNowMs: 9_999_000, skewMs: 5_000 }),
    ).toBe(1_000);
  });

  it("switches to the live client clock (+skew) after mount", () => {
    expect(
      resolveClockNowSec({ mounted: true, serverNowSec: 1_000, clientNowMs: 2_000_500, skewMs: 1_000 }),
    ).toBe(2_001);
  });

  it("falls back to the client clock when no server time was provided", () => {
    expect(resolveClockNowSec({ mounted: false, clientNowMs: 42_900, skewMs: 0 })).toBe(42);
  });

  it("countdown text is identical for server render and hydration render even with client skew", () => {
    const serverNowSec = 1_800_000_000;
    const market = buildFixtureMarkets(serverNowSec)[0]!;
    const serverText = getCountdown(market, serverNowSec).relativeLabel;
    const hydrationNow = resolveClockNowSec({
      mounted: false,
      serverNowSec,
      clientNowMs: (serverNowSec + 125) * 1000, // client clock 2m05s ahead
      skewMs: 0,
    });
    expect(getCountdown(market, hydrationNow).relativeLabel).toBe(serverText);
  });
});
