/**
 * Railway / prod entry — calendar mode only.
 *
 * Start: `node dist/worker.js` (DEPLOY.md §4).
 * Loads idl/meridian.prod.json; refuses fixture IDL off localnet.
 * Does NOT import modes/sim.ts (fixture isolation).
 */
import { loadConfig, loadKeypair } from "./config";
import { createProgram, idlHasSimFixtures } from "./solana/client";
import { createCalendarState, runMorningCreate, runSettlePass } from "./modes/calendar";

async function main() {
  const cfg = loadConfig();
  if (cfg.mode === "sim") {
    throw new Error(
      "worker.ts is calendar-only. Use `yarn automation:sim` / node dist/sim-lifecycle.js for MODE=sim"
    );
  }
  if (!cfg.keypairRaw) {
    throw new Error("AUTOMATION_KEYPAIR required for worker");
  }

  const authority = loadKeypair(cfg);
  const { program, idl } = createProgram(cfg, authority);

  if (cfg.cluster !== "localnet" && idlHasSimFixtures(idl)) {
    throw new Error("Prod worker loaded fixture IDL — aborting");
  }

  console.log(
    `[worker] start cluster=${cfg.cluster} program=${cfg.programId.toBase58()} ` +
      `idl=${cfg.idlPath} createHourEt=${cfg.createHourEt} settleHourEt=${cfg.settleHourEt}`
  );

  const state = createCalendarState();

  const tick = async () => {
    try {
      await runMorningCreate({ cfg, program, authority, state });
    } catch (e) {
      console.error(`[worker] morning create error: ${e}`);
    }
    try {
      await runSettlePass({ cfg, program, authority, state });
    } catch (e) {
      console.error(`[worker] settle pass error: ${e}`);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, cfg.workerTickMs);
}

main().catch((e) => {
  console.error(`[worker] fatal: ${e}`);
  process.exit(1);
});
