#!/usr/bin/env node
/**
 * Set TODAY's operator-sourced equity prices on Railway meridian-staging / automation (Debu-approved while Hermes
 * returns 403 for equities, DLV-106). Never invents prices: the operator types real ones plus where they came from.
 *
 *   # strikes — before the 09:30 ET open (08:30 CT), all 7 MAG7, today's ET date:
 *   node ops/operator-prices.cjs strike --source "Nasdaq pre-market last sale 09:15 ET" \
 *     AAPL=227.31 MSFT=414.20 GOOGL=162.00 AMZN=186.05 NVDA=138.50 META=572.10 TSLA=248.75
 *   # closes — at/after the 16:00 ET close (15:00 CT):
 *   node ops/operator-prices.cjs close --source "Nasdaq official closing price" AAPL=... (all 7)
 *
 * Flags: --dry-run (validate + show what would be set, no Railway call) · --date YYYY-MM-DD (must be today ET) ·
 *        --no-restart (set only; the worker reads env at START, so it only takes effect on the next redeploy) ·
 *        --clear <strike|close> (empty the variable).
 * Needs RAILWAY_PROJECT_TOKEN (meridian-staging) in the environment; RAILWAY_API_TOKEN is removed for the call.
 * Prints variable names, the date, the source and the parsed prices — never a token, never other variables.
 * The variable is set with --skip-deploys, then `railway redeploy --service automation` restarts the worker so it reads
 * the new value (unless --no-restart). A restart is safe: settle re-scans open markets on-chain, create is idempotent.
 */
"use strict";
const { spawnSync } = require("child_process");
const op = require("./lib/operator-prices.cjs");

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: operator-prices.cjs <strike|close> --source \"<where from>\" AAPL=… MSFT=… GOOGL=… AMZN=… NVDA=… META=… TSLA=… [--dry-run] [--date YYYY-MM-DD] [--no-restart]\n       operator-prices.cjs --clear <strike|close> [--no-restart]");
  process.exit(2);
}

function railway(args, input, what) {
  const r = spawnSync("railway", args, { input, env: op.railwayEnv(process.env), encoding: "utf8", cwd: "/tmp" });
  // CLI output is suppressed on purpose (it can echo variables); only the status is shown.
  if (r.error || r.status !== 0) {
    console.error(`railway ${what} FAILED (exit ${r.status ?? "spawn error"}; CLI output suppressed — re-check with --dry-run and the project token scope)`);
    process.exit(4);
  }
}
function railwaySet(varName, value, restart) {
  const clear = value === "";
  railway(op.railwayArgs(varName, { skipDeploys: true, clear }), clear ? undefined : value, `variable set ${varName}`);
  if (restart) railway(op.railwayRedeployArgs(), undefined, "redeploy automation");
}

const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const bool = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const dry = bool("--dry-run");
const restart = !bool("--no-restart");
const clear = flag("--clear");
if (clear !== undefined) {
  if (clear !== "strike" && clear !== "close") usage("--clear needs strike or close");
  const name = clear === "strike" ? "OPERATOR_STRIKE_PRICES" : "OPERATOR_CLOSE_PRICES";
  if (dry) { console.log(`[dry-run] would clear ${name} on meridian-staging/automation`); process.exit(0); }
  railwaySet(name, "", restart);
  console.log(`cleared ${name} on meridian-staging/automation${restart ? " — automation redeploy started" : " (no restart)"}`);
  process.exit(0);
}
const source = flag("--source");
const dateKey = flag("--date");
const kind = argv.shift();
if (!kind) usage("kind missing");
let r;
try {
  r = op.validateOperatorPrices({ kind, source, dateKey, prices: op.parsePriceArgs(argv), nowSec: Math.floor(Date.now() / 1000) });
} catch (e) {
  console.error(String(e.message || e));
  process.exit(3);
}
const j = JSON.parse(r.json);
console.log(`${r.varName} for ${r.dateKey} — source: ${j.source}`);
for (const [s, v] of Object.entries(j.pricesE6)) console.log(`  ${s.padEnd(5)} ${(Number(v) / 1e6).toFixed(6)}`);
for (const w of r.warnings) console.log(`WARNING ${w}`);
if (dry) { console.log("[dry-run] valid — nothing set"); process.exit(0); }
railwaySet(r.varName, r.json, restart);
console.log(`set ${r.varName} on meridian-staging/automation${restart ? " — automation redeploy started (the worker reads it on start; ~1–2 min)" : " (no restart — the worker reads it only after the next redeploy)"}`);
