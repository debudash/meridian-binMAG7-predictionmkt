#!/usr/bin/env bash
# Fail if apps copies of meridian.prod.json drift from root idl/meridian.prod.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_IDL="$ROOT/idl/meridian.prod.json"
WEB_IDL="$ROOT/apps/web/src/idl/meridian.prod.json"
AUTO_IDL="$ROOT/apps/automation/idl/meridian.prod.json"

if [[ ! -f "$ROOT_IDL" ]]; then
  echo "assert-idl-sync: missing $ROOT_IDL" >&2
  exit 1
fi

fail=0
for copy in "$WEB_IDL" "$AUTO_IDL"; do
  if [[ ! -f "$copy" ]]; then
    echo "assert-idl-sync: FAIL — missing $copy (run yarn build:prod-idl)" >&2
    fail=1
    continue
  fi
  if ! cmp -s "$ROOT_IDL" "$copy"; then
    echo "assert-idl-sync: FAIL — drift between $ROOT_IDL and $copy" >&2
    fail=1
  else
    echo "assert-idl-sync: OK $copy"
  fi
done

# Structured check: fixture ix / type names must not appear as IDL entries
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
  console.error("assert-idl-sync: FAIL — fixture entries in prod IDL:", {ix, ty});
  process.exit(1);
}
console.log("assert-idl-sync: prod IDL fixture entries OK");
' "$ROOT_IDL" || fail=1

exit $fail
