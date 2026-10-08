/**
 * Railway / prod entry — calendar mode only.
 *
 * Start: `node dist/worker.js` (DEPLOY.md §4).
 * Loads packaged idl/meridian.prod.json; refuses fixture IDL off localnet.
 * Does NOT import modes/sim.ts (fixture isolation).
 * Optional HTTP /health for Railway healthcheckPath (HEALTH_PORT, default 8080).
 */
import * as http from "http";
import { loadConfig, loadKeypair, resolveSettler } from "./config";
import { createProgram, idlHasSimFixtures } from "./solana/client";
import { createCalendarState, runMorningCreate, runSettlePass } from "./modes/calendar";

function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "meridian-automation" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => {
    console.log(`[worker] health listening on :${port}/health`);
  });
  return server;
}

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
  // M3: permissionless settle is signed + paid by a separate low-balance key, not the authority.
  const settler = resolveSettler(cfg, authority);
  const settlerProgram = settler.separate ? createProgram(cfg, settler.keypair).program : program;
  if (!settler.separate) {
    console.warn(
      `[worker] WARNING: SETTLER_KEYPAIR unset on ${cfg.cluster} — settle falls back to the config authority (M3). Set a separate low-balance key.`
    );
  } else {
    console.log(`[worker] settler=${settler.keypair.publicKey.toBase58()} (authority kept for create / admin_settle)`);
  }

  if (cfg.cluster !== "localnet" && idlHasSimFixtures(idl)) {
    throw new Error("Prod worker loaded fixture IDL — aborting");
  }

  const healthPort = Number(process.env.HEALTH_PORT ?? process.env.PORT ?? "8080");
  if (Number.isFinite(healthPort) && healthPort > 0) {
    startHealthServer(healthPort);
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
      await runSettlePass({ cfg, program, authority, settler: { keypair: settler.keypair, program: settlerProgram }, state });
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
