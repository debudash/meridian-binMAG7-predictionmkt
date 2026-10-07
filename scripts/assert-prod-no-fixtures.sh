#!/usr/bin/env bash
# Fail if production .so or prod IDL contains localnet fixture symbols.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="${1:-$ROOT/target/deploy/meridian.so}"
PROD_IDL="${2:-$ROOT/idl/meridian.prod.json}"
PATTERN='UpsertMockPyth|TestDrainVault|SimOpenSession|SimCloseSession|upsert_mock_pyth|test_drain_vault|sim_open_session|sim_close_session|sim_clock|SimClock'

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
  if grep -Eiq "$PATTERN" "$PROD_IDL"; then
    echo "assert-prod-no-fixtures: FAIL — fixture strings found in $PROD_IDL" >&2
    exit 1
  fi
  echo "assert-prod-no-fixtures: prod IDL OK ($PROD_IDL)"
else
  echo "assert-prod-no-fixtures: WARN — no prod IDL at $PROD_IDL (run yarn build:prod-idl)"
fi
