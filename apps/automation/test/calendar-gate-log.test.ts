/**
 * Before 16:00 ET the settle pass is expected to idle every tick; that is not an error
 * (Railway logs showed "[calendar] Error: Calendar settle rejected: … < 16:00 ET gate" every minute).
 */
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { loadConfig } from "../src/config";
import { createCalendarState, runSettlePass } from "../src/modes/calendar";

describe("calendar settle gate log", () => {
  it("before the ET gate: logs a non-error 'waiting for 16:00 ET gate' line and touches no RPC", async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const cfg = loadConfig({ SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any);
      const program = { account: new Proxy({}, { get: () => { throw new Error("no RPC expected"); } }) } as any;
      // 2026-10-08 10:30 ET
      await runSettlePass({ cfg, program, authority: Keypair.generate(), state: createCalendarState(), now: new Date("2026-10-08T14:30:00Z") });
    } finally {
      console.log = orig;
    }
    expect(lines.join("\n")).to.match(/\[calendar\] waiting for 16:00 ET gate \(now 10:30 ET\)/);
    expect(lines.join("\n")).not.to.match(/Error|rejected/);
  });
});
