#!/usr/bin/env node
/**
 * Emit idl/meridian.prod.json from a full (localnet) IDL by stripping fixture ixs
 * and orphan fixture-only types. Also syncs copies into apps for Railway packaging:
 *   - apps/web/src/idl/meridian.prod.json
 *   - apps/automation/idl/meridian.prod.json
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

/** Types that exist only for fixture ixs — strip from prod IDL. */
const FIXTURE_TYPES = new Set(["MockPythParams"]);

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
if (Array.isArray(idl.types)) {
  idl.types = idl.types.filter((t) => !FIXTURE_TYPES.has(t.name));
}

const outs = [
  path.join(root, "idl/meridian.prod.json"),
  path.join(root, "apps/web/src/idl/meridian.prod.json"),
  path.join(root, "apps/automation/idl/meridian.prod.json"),
];

const body = JSON.stringify(idl, null, 2) + "\n";
for (const out of outs) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  console.log(`emit-prod-idl: wrote ${out}`);
}
console.log(
  `emit-prod-idl: ${idl.instructions.length} instructions, ${(idl.types || []).length} types from ${src}`
);
