/**
 * LOCALNET-ONLY one-command sim lifecycle entry (D-017).
 *
 *   yarn automation:sim
 *   npm run sim-lifecycle --prefix apps/automation
 *
 * Requires SOLANA_CLUSTER=localnet, MODE=sim, localnet IDL (meridian.json).
 * Never deploy this entry on Railway. Never set ANCHOR_FEATURES=localnet-test on Railway.
 */
import { loadConfig, loadKeypair } from "./config";
import { createProgram } from "./solana/client";
import { runSimLifecycle, SIM_MODULE_MARKER } from "./modes/sim";

async function main() {
  process.env.MODE = process.env.MODE || "sim";
  process.env.SOLANA_CLUSTER = process.env.SOLANA_CLUSTER || "localnet";
  if (!process.env.MERIDIAN_IDL_PATH) {
    process.env.MERIDIAN_IDL_PATH = "../../idl/meridian.json";
  }

  const cfg = loadConfig();
  console.log(`[sim-lifecycle] ${SIM_MODULE_MARKER}`);
  console.log(
    `[sim-lifecycle] cluster=${cfg.cluster} mode=${cfg.mode} idl=${cfg.idlPath}`
  );

  if (cfg.cluster !== "localnet" || cfg.mode !== "sim") {
    throw new Error("sim-lifecycle requires MODE=sim and SOLANA_CLUSTER=localnet");
  }
  if (!cfg.keypairRaw) {
    throw new Error("AUTOMATION_KEYPAIR required");
  }

  const authority = loadKeypair(cfg);
  const { program } = createProgram(cfg, authority);
  await runSimLifecycle({ cfg, program, authority });
}

main().catch((e) => {
  console.error(`[sim-lifecycle] fatal: ${e}`);
  process.exit(1);
});
