#!/usr/bin/env bash
# Fail if production .so or prod IDL contains localnet fixture symbols.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="${1:-$ROOT/target/deploy/meridian.so}"
PROD_IDL="${2:-$ROOT/idl/meridian.prod.json}"
PATTERN='UpsertMockPyth|TestDrainVault|SimOpenSession|SimCloseSession|InitSimClock|SetSimClock|WarpSimClock|DisableSimClock|upsert_mock_pyth|test_drain_vault|sim_open_session|sim_close_session|init_sim_clock|set_sim_clock|warp_sim_clock|disable_sim_clock|sim_clock|SimClock'

if [[ ! -f "$SO" ]]; then
  echo "assert-prod-no-fixtures: missing .so at $SO" >&2
  exit 1
fi
if strings "$SO" | grep -Eiq "$PATTERN"; then
  echo "assert-prod-no-fixtures: FAIL — fixture strings found in $SO" >&2
  strings "$SO" | grep -Ei "$PATTERN" >&2 || true
  exit 1
fi
echo "assert-prod-no-fixtures: .so OK ($SO)"

if [[ -f "$PROD_IDL" ]]; then
  # Structured check: fixture *instruction/type names* only (IDL docs may mention sim_*).
  node -e '
const fs = require("fs");
const idl = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const FIXTURE_IX = new Set([
  "upsert_mock_pyth","test_drain_vault","sim_open_session","sim_close_session",
  "sim_open","sim_close","init_sim_clock","set_sim_clock","warp_sim_clock","disable_sim_clock",
]);
const FIXTURE_TYPES = new Set(["MockPythParams","SimClock","SimClockSet"]);
const ix = (idl.instructions||[]).map(i => i.name).filter(n => FIXTURE_IX.has(n));
const ty = (idl.types||[]).map(t => t.name).filter(n => FIXTURE_TYPES.has(n));
if (ix.length || ty.length) {
  console.error("assert-prod-no-fixtures: FAIL — fixture entries in prod IDL:", {ix, ty});
  process.exit(1);
}
console.log("assert-prod-no-fixtures: prod IDL OK (" + process.argv[1] + ")");
' "$PROD_IDL"
else
  echo "assert-prod-no-fixtures: WARN — no prod IDL at $PROD_IDL (run yarn build:prod-idl)"
fi
