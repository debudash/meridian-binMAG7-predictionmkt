#!/usr/bin/env node
/**
 * Emit idl/meridian.prod.json from a full (localnet) IDL by stripping fixture ixs.
 * Prod clients must use meridian.prod.json — never call drain/mock/sim ixs.
 */
const fs = require("fs");
const path = require("path");

const FIXTURE_IX = new Set([
  "upsert_mock_pyth",
  "test_drain_vault",
  "sim_open_session",
  "sim_close_session",
  "sim_open",
  "sim_close",
  "init_sim_clock",
  "set_sim_clock",
  "warp_sim_clock",
  "disable_sim_clock",
]);

const root = path.join(__dirname, "..");
const srcCandidates = [
  path.join(root, "target/idl/meridian.json"),
  path.join(root, "idl/meridian.json"),
];
const src = srcCandidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error("emit-prod-idl: no source IDL found");
  process.exit(1);
}
const idl = JSON.parse(fs.readFileSync(src, "utf8"));
idl.instructions = (idl.instructions || []).filter((ix) => !FIXTURE_IX.has(ix.name));
// Drop types only used by fixtures if present (best-effort)
const out = path.join(root, "idl/meridian.prod.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(idl, null, 2) + "\n");
console.log(`emit-prod-idl: wrote ${out} (${idl.instructions.length} instructions) from ${src}`);
