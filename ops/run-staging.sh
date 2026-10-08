#!/bin/bash
# Meridian devnet staging pipeline (operator box). Committed copy of the former box-only script (review dd46769):
# every key path, RPC, program id and secret comes from env (or an untracked env file), nothing is hardcoded.
#
#   wait for SOL → build prod .so from LATEST origin/main → deploy (or upgrade if the on-chain bytes differ) → dump the
#   DEPLOYED program + assert no fixtures → bootstrap TODAY's 0DTE markets (expiry 16:00 ET today, ATM strikes from a fresh
#   reference price; DLV-118) + Debu wallet + wallet B + settler + pauser, Phoenix
#   books handed to the pauser (PSM NameSuccessor + ClaimSeatManagerAuthority) → pause watcher (books → Paused at expiry)
#   → e2e Buy Yes/No → [wait for Debu's START signal] → 20-min AAPL ATM market WITH a Phoenix book → pause at expiry →
#   permissionless Pyth pull settle (Hermes key, settler) → admin_settle fallback → redeem.
#
# ── CONFIG ───────────────────────────────────────────────────────────────────────────────────────────────────────────
#   Values come from the environment, optionally from STAGING_ENV_FILE (default: $OPS_DIR/staging.env, untracked,
#   chmod 600; see ops/staging.env.example). Secrets (PYTH_HERMES_API_KEY) stay in the process env and are never
#   written, echoed or put in a URL. Required: KEYS_DIR STATE REPO BUILD RPC MERIDIAN_PROGRAM_ID.
#   Keys (in $KEYS_DIR, chmod 600, never committed): upgrade-authority.json (payer + Phoenix book creator; NEVER on
#   Railway), keeper.json (config authority), admin.json, maker.json, trader.json, usdc-mint.json, wallet-b.json,
#   settler.json (permissionless settle), pauser.json (Phoenix seat-manager authority after the handoff), and the
#   program keypair ($PROGRAM_KEYPAIR).
# ── TODAY'S MARKETS (DLV-118, SPEC §1 / §3.3) ───────────────────────────────────────────────────────────────────────
#   `ops-cli market-day --strikes` → $RUN_TMP/today-plan.json: expiry = 16:00 America/New_York TODAY (DST-aware), one ATM
#   strike per STRIKE_SYMBOLS (default MAG7) on the previous trading day's close (D-026): Hermes at that close (if the key
#   is entitled; equities are 403 today, DLV-106) → a sponsored Pyth account (PYTH_PRICE_FEEDS) posted at that close → the
#   operator file $STRIKE_PRICES_FILE (default $OPS_DIR/STRIKE_PRICES_TODAY.json:
#   {"dateKey":"<market day>","closeDateKey":"<previous trading day>","source":"…","pricesE6":{"AAPL":"227310000",…}}).
#   After the close / weekend / NYSE holiday it REFUSES (exit 7, nothing created) — never next-close books.
# ── HOW DEBU STARTS THE 20-MINUTE AAPL ATM MARKET ─────────────────────────────────────────────────────────────────────
#   After bootstrap + e2e the log says "waiting for START signal". Start it (up to START_WAIT_HOURS=24 later) with:
#       touch $START_FILE (default $OPS_DIR/START_20M)   ← preferred; consumed (renamed) when used
#       START_20M=now bash run-staging.sh   |   bash run-staging.sh --start-20m-now
#   expiry = chain time + SHORT_MIN (20) min + SHORT_SETUP_SECS (180 s), so ≥ 20 min of trading remain after
#   "SHORT MARKET READY". At expiry the book is PAUSED (cancel + withdraw only). From expiry + PULL_SETTLE_AFTER (90 s)
#   the settler tries the permissionless Pyth pull settle (needs PYTH_HERMES_API_KEY); if that hasn't settled by
#   expiry + SETTLE_AFTER (330 s = admin_settle_delay_secs 300 + 30) the keeper admin_settles, then the trader redeems.
# ── ADMIN_SETTLE FALLBACK PRICE (Reviewers mr72-73 M3) ───────────────────────────────────────────────────────────────
#   Never the stale pyth-read.py account price. `ops-cli admin-price` returns the Hermes price AT EXPIRY (publish_time
#   within ADMIN_PRICE_MAX_SKEW_SECS=60 (the on-chain window; ≤ 300 as a logged override) of expiry, market feed, sane confidence). If Hermes can't give one (off-hours,
#   no key, outage) the script REFUSES, logs "[settle] ALERT", and waits (OPERATOR_PRICE_WAIT_HOURS=24) for the operator
#   to write $ADMIN_PRICE_FILE (default $OPS_DIR/ADMIN_PRICE_20M) with three lines:
#       market=<20-min strike market>   price_e6=<integer micro-USD>   source=<where the price came from>
#   The file is validated by the same ops-cli check (bound to the market, source required), logged, and consumed.
# ── SEAT-MANAGER HANDOFF REPAIR ─────────────────────────────────────────────────────────────────────────────────────
#   After each bootstrap phase every book in $STATE (incl. books created before !73) goes through the
#   idempotent `ops-cli handoff` (upgrade key → pauser, PSM 6 + 7), then `pause-status --expect-pauser` (no key) must
#   show the pauser as SM authority for every book, else "[pause] ALERT".
# ── DRY RUN ───────────────────────────────────────────────────────────────────────────────────────────────────────────
#   DRY_RUN=1 bash run-staging.sh  (or --dry-run): prints the plan and exits 0. No SOL wait, no build, no deploy, zero
#   transactions (only a read-only getBalance).
# Railway: this script makes NO Railway calls, and it unsets RAILWAY_API_TOKEN / RAILWAY_TOKEN itself (L6d) so no
#   child process can inherit a Railway credential, whatever the launching shell had.
# Safety (review mr72-73 L6): devnet genesis-hash guard before deploy / bootstrap / settle; per-run mktemp dir; the state
#   path is passed to Python as argv; mint / pause-once failures log ALERTs. `set -e` stays off on purpose: each step
#   checks its own exit so a failed optional step (e2e, web check) can't abort a live market mid-session.
set -uo pipefail
unset RAILWAY_API_TOKEN RAILWAY_TOKEN
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
RUN_TMP=$(mktemp -d -t stg-run.XXXXXX)
trap 'rm -rf "$RUN_TMP"' EXIT   # Reviewers nit: per-run temp dir cleaned up
OPS_DIR=${OPS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
ENV_FILE=${STAGING_ENV_FILE:-$OPS_DIR/staging.env}
# shellcheck disable=SC1090
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi   # exported: the .cjs scripts read the same vars
: "${KEYS_DIR:?set KEYS_DIR (dir with the staging keypairs)}" "${STATE:?set STATE (bootstrap state json)}"
: "${REPO:?set REPO (git clone of peak6-meridian)}" "${BUILD:?set BUILD (detached build worktree path)}"
: "${RPC:?set RPC (devnet RPC URL)}" "${MERIDIAN_PROGRAM_ID:?set MERIDIAN_PROGRAM_ID}"
export PATH=$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH
export GITLAB_HOST=${GITLAB_HOST:-labs.gauntletai.com} CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-4}   # shared box: -j4
K=$KEYS_DIR; PROG=$MERIDIAN_PROGRAM_ID
SO=$BUILD/target/deploy/meridian.so
AUTO=${AUTO:-$BUILD/apps/automation}                 # ops-cli (pause / handoff / pull settle / admin-price) built from origin/main
UPGRADE_KEY=${UPGRADE_KEY:-$K/upgrade-authority.json}; PROGRAM_KEYPAIR=${PROGRAM_KEYPAIR:-$K/program.json}
DEPLOYED_DUMP=${DEPLOYED_DUMP:-$RUN_TMP/deployed-meridian.so}
REQUIRE_PULL_ORACLE=${REQUIRE_PULL_ORACLE:-1}
PAYER=$(solana-keygen pubkey "$UPGRADE_KEY"); MIN_SOL=${MIN_SOL:-9}; WAIT_HOURS=${WAIT_HOURS:-48}
DEBU=${DEBU_WALLET:-}
WEB_VARS=${WEB_VARS:-}; WEB_CLUSTER=devnet            # never `custom` (Reviewers M2)
WEB_SRC=${WEB_SRC:-}; WEB_URL=${WEB_URL:-}            # e2e runs inside a prepared apps/web checkout (node_modules)
SHORT_MIN=${SHORT_MIN:-20}; SHORT_SETUP_SECS=${SHORT_SETUP_SECS:-180}; SETTLE_AFTER=${SETTLE_AFTER:-330}
PULL_SETTLE_AFTER=${PULL_SETTLE_AFTER:-90}
START_FILE=${START_FILE:-$OPS_DIR/START_20M}; START_WAIT_HOURS=${START_WAIT_HOURS:-24}
WALLET_B_KEY=${WALLET_B_KEY:-$K/wallet-b.json}; SETTLER_KEY=${SETTLER_KEY:-$K/settler.json}; PAUSER_KEY=${PAUSER_KEY:-$K/pauser.json}
PAUSE_LOG=${PAUSE_LOG:-${STATE%.json}-pause.log}
STRIKE_PRICES_FILE=${STRIKE_PRICES_FILE:-$OPS_DIR/STRIKE_PRICES_TODAY.json}; TODAY_PLAN=$RUN_TMP/today-plan.json
# ONE CREATOR (DLV-119): the Railway automation worker creates the daily markets; this box run does not unless
# BOOTSTRAP_DAILY_MARKETS=1 (staging.env). Wallets / mUSDC / settler / pauser / Config / the 20-min market are unaffected.
BOOTSTRAP_DAILY_MARKETS=${BOOTSTRAP_DAILY_MARKETS:-0}; export BOOTSTRAP_DAILY_MARKETS
ADMIN_PRICE_FILE=${ADMIN_PRICE_FILE:-$OPS_DIR/ADMIN_PRICE_20M}; OPERATOR_PRICE_WAIT_HOURS=${OPERATOR_PRICE_WAIT_HOURS:-24}
for a in "$@"; do case $a in --start-20m-now) START_20M=now;; --dry-run) DRY_RUN=1;; esac; done
START_20M=${START_20M:-wait}; DRY_RUN=${DRY_RUN:-0}
WALLET_B_PUB=${WALLET_B:-$(solana-keygen pubkey "$WALLET_B_KEY" 2>/dev/null || echo "MISSING($WALLET_B_KEY)")}
SETTLER_PUB=$(solana-keygen pubkey "$SETTLER_KEY" 2>/dev/null || echo "MISSING($SETTLER_KEY)")
PAUSER_PUB=$(solana-keygen pubkey "$PAUSER_KEY" 2>/dev/null || echo "MISSING($PAUSER_KEY)")
KEEPER_PUB=$(solana-keygen pubkey "$K/keeper.json" 2>/dev/null || echo "")
# L5: pubkeys the pauser must never equal (keeper, settler, upgrade key) — pubkeys only, no key loaded for the check
PAUSER_MUST_DIFFER_FROM=$(printf '%s\n' "$PAYER" "$KEEPER_PUB" "$SETTLER_PUB" | grep -v -e '^$' -e '^MISSING' | paste -sd, -)
HERMES=$([ -n "${PYTH_HERMES_API_KEY:-}" ] && echo set || echo MISSING)   # name only, never the value
export SHORT_MIN SHORT_SETUP_SECS WALLET_B_KEY SETTLER_KEY PAUSER_KEY KEYS="$K" MERIDIAN_PROGRAM_ID
log(){ echo "[$(date '+%F %T %Z')] $*"; }
ct(){ TZ=America/Chicago date -d "@$1" '+%F %T %Z'; }
# Phoenix book ≈ 1.7 SOL rent. Reserve: Debu 2 + 20-min market book 1.7 + wallet-B payer fallback 0.5 + 0.7 fees.
nbooks(){ awk "BEGIN{n=int(($1-2-1.7-0.5-0.7)/1.7); if(n>3)n=3; if(n<1)n=1; print n}"; }
bal(){ solana balance "$PAYER" -u "$RPC" 2>/dev/null | awk '{print $1}'; }
ops_cli(){   # automation ops-cli with the pauser / settler keys passed as file paths (never their bytes)
  ( cd "$AUTO" && PAUSER_MUST_DIFFER_FROM=$PAUSER_MUST_DIFFER_FROM SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=devnet MERIDIAN_PROGRAM_ID=$PROG MERIDIAN_IDL_PATH=$BUILD/idl/meridian.prod.json \
      PHOENIX_PAUSER_KEYPAIR=$PAUSER_KEY SETTLER_KEYPAIR=$SETTLER_KEY node dist/ops-cli.js "$@" )
}
ops_cli_ro(){   # read-only ops-cli status reads: no pauser / settler key at all, not even inherited
  ( cd "$AUTO" && env -u PHOENIX_PAUSER_KEYPAIR -u SETTLER_KEYPAIR SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=devnet MERIDIAN_PROGRAM_ID=$PROG \
      MERIDIAN_IDL_PATH=$BUILD/idl/meridian.prod.json node dist/ops-cli.js "$@" )
}
# DLV-118: today's plan (session + ATM strikes on the previous trading day's close, D-026). Exit 5 from ops-cli = no same-day session
# (DLV-119 M-1: an early-close day is refused too — plan_refused logs it as an ALERT).
today_plan(){
  ( cd "$AUTO" && env -u PHOENIX_PAUSER_KEYPAIR -u SETTLER_KEYPAIR SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=devnet MERIDIAN_PROGRAM_ID=$PROG \
      MERIDIAN_IDL_PATH=$BUILD/idl/meridian.prod.json OPERATOR_STRIKE_PRICES_FILE=$STRIKE_PRICES_FILE node dist/ops-cli.js market-day --strikes ) >"$TODAY_PLAN"
}
plan_refused(){   # $1 = context; logs the refusal, as an ALERT for early_close / unknown_year
  local code; code=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("code",""))' "$TODAY_PLAN" 2>/dev/null)
  case "$code" in early_close|unknown_year) log "[create] ALERT $1 refused ($code): $(cat "$TODAY_PLAN")";; *) log "$1 refused: $(cat "$TODAY_PLAN")";; esac
}
# !77 L-3: EXPECTED_PAUSER_PUB (staging.env) pins the pauser pubkey; unset → WARNING only (pre-pin configs keep working).
pauser_pin_ok(){
  if [ -z "${EXPECTED_PAUSER_PUB:-}" ]; then log "WARNING EXPECTED_PAUSER_PUB unset in staging.env — pauser key not pinned (!77 L-3)"; return 0; fi
  [ "$PAUSER_PUB" = "$EXPECTED_PAUSER_PUB" ]
}
# Seat-manager authority → pauser for EVERY book in $STATE (idempotent; pre-!73 books included), then the read-only gate.
# $1 = 1 for a dry run (reads only). Returns non-zero if any book isn't on the pauser afterwards.
handoff_repair(){
  [ -f "$PAUSER_KEY" ] || { log "[pause] ALERT no pauser key ($PAUSER_KEY) — handoff repair skipped; books can't be paused"; return 1; }
  # !77 L-3: a mis-pointed PAUSER_KEY must never receive the SM authority — compare with the pinned EXPECTED_PAUSER_PUB first.
  pauser_pin_ok || { log "[pause] ALERT handoff ABORTED: $PAUSER_KEY is $PAUSER_PUB, not EXPECTED_PAUSER_PUB=${EXPECTED_PAUSER_PUB:-} (staging.env)"; return 1; }
  local dry=${1:-0} i rc=1
  for i in 1 2 3; do
    ( cd "$AUTO" && env -u SETTLER_KEYPAIR SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=devnet MERIDIAN_PROGRAM_ID=$PROG MERIDIAN_IDL_PATH=$BUILD/idl/meridian.prod.json \
        PHOENIX_PAUSER_KEYPAIR=$PAUSER_KEY SEAT_MANAGER_AUTHORITY_KEYPAIR=$UPGRADE_KEY PAUSER_MUST_DIFFER_FROM=$PAUSER_MUST_DIFFER_FROM DRY_RUN=$dry node dist/ops-cli.js handoff --state "$STATE" ) 2>&1 | while read -r l; do log "$l"; done
    ops_cli_ro pause-status --state "$STATE" --expect-pauser "$PAUSER_PUB" 2>&1 | while read -r l; do log "$l"; done
    rc=$?; { [ "$rc" = 0 ] || [ "$dry" = 1 ]; } && break
    log "[pause] ALERT handoff repair attempt $i: not every book has the pauser as SM authority — retrying in 30 s"; sleep 30
  done
  [ "$rc" = 0 ] || log "[pause] ALERT handoff repair: some book is NOT on the pauser $PAUSER_PUB (see the status lines above)"
  return $rc
}
# M3: admin_settle fallback price for strike market $1 — Hermes at expiry, else a market-bound operator price with its
# source. Prints "price_e6<TAB>source" on success; non-zero (and nothing on stdout) when refused. Never stale.
admin_price(){
  local out
  out=$(ops_cli_ro admin-price --market "$1" 2>&1); echo "$out" | while read -r l; do log "  $l"; done >&2
  echo "$out" | grep -q '^ADMIN_PRICE_OK ' || return 1
  echo "$out" | sed -nE 's/^ADMIN_PRICE_OK price_e6=([0-9]+) source=(.*)$/\1\t\2/p'
}
read_operator_price(){   # $ADMIN_PRICE_FILE → export lines for OPERATOR_PRICE_{MARKET,E6,SOURCE} (parsed + quoted, never sourced raw)
  python3 - "$ADMIN_PRICE_FILE" <<'PY'
import sys, shlex
kv = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); kv[k.strip().lower()] = v.strip()
for k, env in (("market", "OPERATOR_PRICE_MARKET"), ("price_e6", "OPERATOR_PRICE_E6"), ("source", "OPERATOR_PRICE_SOURCE")):
    print(f"export {env}={shlex.quote(kv.get(k, ''))}")
PY
}
# L6a: refuse to touch anything that isn't devnet (the upgrade key would deploy to whatever $RPC is).
assert_devnet(){
  local gh; gh=$(solana genesis-hash -u "$RPC" 2>/dev/null)
  [ "$gh" = "$DEVNET_GENESIS" ] || { log "ABORT: $RPC genesis hash '${gh:-unreachable}' is not devnet ($DEVNET_GENESIS) — refusing deploy/bootstrap/settle"; exit 8; }
  log "devnet guard: $RPC genesis $gh (devnet)"
}
build_latest_main(){
  [ -e "$BUILD/.git" ] || git -C "$REPO" worktree add --detach "$BUILD" origin/main >/dev/null 2>&1 || { log "build: worktree add failed"; return 1; }
  git -C "$BUILD" fetch -q origin main && git -C "$BUILD" checkout -q --detach origin/main || { log "build: fetch/checkout origin/main failed"; return 1; }
  log "build: prod anchor build (no features) at origin/main $(git -C "$BUILD" rev-parse --short HEAD) — $(git -C "$BUILD" log -1 --format=%s | cut -c1-80)"
  ( cd "$BUILD" && anchor build >"${BUILD_LOG:-$RUN_TMP/build.log}" 2>&1 && node scripts/emit-prod-idl.js >>"${BUILD_LOG:-$RUN_TMP/build.log}" 2>&1 \
      && bash scripts/assert-prod-no-fixtures.sh target/deploy/meridian.so idl/meridian.prod.json ) || { log "build: FAILED (see ${BUILD_LOG:-$RUN_TMP/build.log})"; return 1; }
  if [ "$REQUIRE_PULL_ORACLE" = 1 ] && ! grep -q PythPriceNotAtExpiry "$BUILD/idl/meridian.prod.json"; then
    log "build: origin/main has no D-025 pull-oracle settle (PythPriceNotAtExpiry missing) — refusing to deploy a legacy-Pyth .so"; return 1; fi
  export MERIDIAN_IDL=$BUILD/idl/meridian.prod.json   # bootstrap + settle-test use the IDL matching the deployed .so
  ( cd "$AUTO" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run -s build >/dev/null 2>&1 ) || { log "build: automation ops-cli build FAILED"; return 1; }
  export AUTOMATION_DIST=$AUTO/dist
}
# Reviewers !63 #1: prove the DEPLOYED bytes are the prod build — dump from devnet and run the repo's fixture assert on it.
assert_deployed_no_fixtures(){
  rm -f "$DEPLOYED_DUMP"
  solana program dump "$PROG" "$DEPLOYED_DUMP" -u "$RPC" >/dev/null 2>&1 || { log "deployed check: program dump FAILED"; return 1; }
  bash "$BUILD/scripts/assert-prod-no-fixtures.sh" "$DEPLOYED_DUMP" "$BUILD/idl/meridian.prod.json" || { log "deployed check: assert-prod-no-fixtures FAILED on the on-chain program"; return 1; }
  log "deployed check: on-chain $PROG passes assert-prod-no-fixtures (dump sha256 $(sha256sum "$DEPLOYED_DUMP" | cut -c1-64))"
}
# Reviewers !63 #2: the web config this pipeline manages must say devnet explicitly (never `custom`).
pin_web_cluster(){
  [ -n "$WEB_VARS" ] && [ -f "$WEB_VARS" ] || { echo "web cluster: WEB_VARS unset/not found — set NEXT_PUBLIC_SOLANA_CLUSTER=$WEB_CLUSTER on the staging web service"; return 0; }
  python3 - "$WEB_VARS" "$WEB_CLUSTER" "${1:-apply}" <<'PY'
import json, os, sys
p, want, mode = sys.argv[1:4]; d = json.load(open(p)); cur = d.get("NEXT_PUBLIC_SOLANA_CLUSTER")
if cur == want: print(f"web cluster: {p} NEXT_PUBLIC_SOLANA_CLUSTER={want} (ok)"); sys.exit(0)
if mode == "plan": print(f"web cluster: would set NEXT_PUBLIC_SOLANA_CLUSTER {cur!r} -> {want!r} in {p}"); sys.exit(0)
d["NEXT_PUBLIC_SOLANA_CLUSTER"] = want; t = p + ".tmp"; json.dump(d, open(t, "w"), indent=2); os.replace(t, p)
print(f"web cluster: set NEXT_PUBLIC_SOLANA_CLUSTER {cur!r} -> {want!r} in {p}")
PY
}
state_set(){ python3 - "$STATE" "$1" <<'PY'
import json, os, sys
p, k = sys.argv[1:3]; d = json.load(open(p)); d[k] = True; t = p + ".tmp"; json.dump(d, open(t, "w"), indent=2); os.replace(t, p)
PY
}
summary(){   # bootstrap summary from $STATE (pubkeys/addresses only)
  log "──── SUMMARY: $1 ────"
  python3 - "$STATE" <<'PY'
import json, sys, datetime, zoneinfo
s = json.load(open(sys.argv[1])); tz = zoneinfo.ZoneInfo("America/Chicago")
ct = lambda t: datetime.datetime.fromtimestamp(t, tz).strftime("%a %b %d %H:%M:%S %Z")
for m in s.get("markets", []):
    print(f"  {'[20-min] ' if m.get('short') else ''}{m['symbol']} >= {m['strikeE6']/1e6:g}  market {m['market']}  "
          f"{'phoenix ' + m['phoenixMarket'] + ' (SM authority ' + m.get('seatManagerAuthority', '?') + ')' if m.get('phoenixMarket') else 'NO BOOK'}  expiry {ct(m['expiryTs'])}")
print(f"  Debu wallet {s.get('debuWallet','-')}   wallet B {s.get('walletB','-')} (SOL via {s.get('walletBFunding',{}).get('solSource','-')})")
print(f"  mUSDC mint {s.get('usdcMint')}   program {s.get('programId')}")
print(f"  settler {s.get('settler','-')} (SOL via {s.get('settlerFunding',{}).get('solSource','-')}; permissionless settle signer/payer, M3)")
print(f"  pauser {s.get('pauser','-')} (SOL via {s.get('pauserFunding',{}).get('solSource','-')}; Phoenix seat-manager authority, pauses books at expiry)")
PY
  log "  wallet B pubkey: $WALLET_B_PUB (keypair $WALLET_B_KEY — import into Phantom as the counterparty)"
}

if [ "$DRY_RUN" = 1 ]; then
  ( assert_devnet ) || log "DRY_RUN: devnet guard FAILED — a real run would abort here (exit 8)"
  log "DRY_RUN=1 — plan only: no SOL wait, no build, no deploy, ZERO transactions (ops dir $OPS_DIR, env file $([ -f "$ENV_FILE" ] && echo "$ENV_FILE" || echo none))"
  b=$(bal); b=${b:-0}; NB=$(nbooks "$b")
  log "0. wait until payer $PAYER has >= $MIN_SOL SOL (now $b, read-only) — poll every 300 s, give up after ${WAIT_HOURS}h"
  log "1. build prod .so from origin/main in $BUILD (CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS) + assert-prod-no-fixtures → deploy/upgrade $PROG; build apps/automation ops-cli"
  log "1b. dump DEPLOYED program (solana program dump $PROG $DEPLOYED_DUMP) → scripts/assert-prod-no-fixtures.sh on the dump → ABORT bootstrap on failure"
  log "1c. $(pin_web_cluster plan)"
  ( cd "$AUTO" && node dist/ops-cli.js market-day ) >"$TODAY_PLAN"; tp_rc=$?   # session only (no RPC) in a dry run
  log "1b. today's session (DLV-118): $(cat "$TODAY_PLAN") — a real run adds ATM strikes via 'ops-cli market-day --strikes' (operator file $STRIKE_PRICES_FILE); exit 5 → no markets (exit 7)"
  [ $tp_rc = 0 ] || log "DRY_RUN: no same-day session right now — a real run would stop before the bootstrap (exit 7)"
  log "2. bootstrap phase 1 (SHORT_PHASE=skip): today's markets (expiry 16:00 ET today) with NBOOKS=$NB books at balance $b; NBOOKS=$(nbooks "$MIN_SOL") at MIN_SOL=$MIN_SOL"
  ( cd "$OPS_DIR" && DRY_RUN=1 TODAY_PLAN=$TODAY_PLAN SHORT_PHASE=all NBOOKS=$NB RPC=$RPC STATE=$STATE DEBU_WALLET=$DEBU node devnet-bootstrap.cjs ) || { log "dry run: bootstrap plan FAILED"; exit 9; }
  if [ -f "$AUTO/dist/ops-cli.js" ] && grep -q expect-pauser "$AUTO/dist/ops-cli.js"; then
    log "2a. handoff repair over every book in $STATE (DRY_RUN reads only; upgrade key → pauser $PAUSER_PUB) + read-only status gate (--expect-pauser):"
    handoff_repair 1 || log "2a. (dry run) gate reports books not yet on the pauser — a real run hands them off"
  else log "2a. handoff repair (ops-cli handoff --state, then the read-only status gate --expect-pauser $PAUSER_PUB) — runs after the build ($AUTO/dist predates it)"; fi
  log "2b. pause watcher: ops-cli pause-watch --state $STATE (pauser $PAUSER_PUB) → PSM ChangeMarketStatus(Paused) at each book's expiry, log $PAUSE_LOG"
  log "3. e2e Buy Yes / Buy No (trader) on today's books, NEXT_PUBLIC_SOLANA_CLUSTER=$WEB_CLUSTER (WEB_SRC=${WEB_SRC:-unset → skipped})"
  if [ "$START_20M" = now ]; then tr="START_20M=now (would start immediately)"; elif [ -e "$START_FILE" ]; then tr="$START_FILE PRESENT (would start immediately)"; else tr="waiting — touch $START_FILE to start"; fi
  log "4. START trigger for the 20-min AAPL ATM market: $tr; timeout ${START_WAIT_HOURS}h → skip"
  log "5. bootstrap phase 2 (SHORT_PHASE=only): AAPL ATM (prior-close reference, D-026) WITH Phoenix book + maker ladder + SM handoff to pauser, expiry = chain now + ${SHORT_MIN}m + ${SHORT_SETUP_SECS}s → handoff repair (all books) → 'SHORT MARKET READY'"
  log "6. trader mints 5 pairs; at expiry: pause-once (book → Paused); expiry+${PULL_SETTLE_AFTER}s: permissionless Pyth pull settle (settler $SETTLER_PUB, PYTH_HERMES_API_KEY $HERMES); expiry+${SETTLE_AFTER}s: admin_settle fallback → redeem"
  log "6b. admin_settle fallback price (M3): ops-cli admin-price = Hermes price at expiry (|publish_time − expiry| <= ${ADMIN_PRICE_MAX_SKEW_SECS:-60}s); else REFUSE + '[settle] ALERT' + wait ${OPERATOR_PRICE_WAIT_HOURS}h for $ADMIN_PRICE_FILE (market= price_e6= source=). Never the stale shard-0 account price"
  log "DRY_RUN complete — 0 transactions sent"; exit 0
fi

deadline=$(( $(date +%s) + WAIT_HOURS*3600 ))
while :; do b=$(bal); b=${b:-0}; if awk "BEGIN{exit !($b >= $MIN_SOL)}"; then break; fi
  [ "$(date +%s)" -gt $deadline ] && { log "gave up waiting for funds (balance $b SOL)"; exit 2; }
  log "waiting for >= $MIN_SOL SOL on $PAYER (now $b)"; sleep 300; done
log "funded: $(bal) SOL"
# 1. program deploy (prod build from latest origin/main; assert no fixtures first)
assert_devnet
build_latest_main || { log "prod build from origin/main FAILED — abort (nothing deployed)"; exit 3; }
log "artifact sha256 $(sha256sum "$SO" | cut -c1-64)"
if solana program show "$PROG" -u "$RPC" >/dev/null 2>&1; then
  if solana program dump "$PROG" "$RUN_TMP/onchain.so" -u "$RPC" >/dev/null 2>&1 && cmp -s -n "$(stat -c%s "$SO")" "$SO" "$RUN_TMP/onchain.so"; then
    log "on-chain program already matches the origin/main build"
  else
    log "on-chain program differs from origin/main build — upgrading"
    for i in 1 2 3; do
      solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" --upgrade-authority "$UPGRADE_KEY" --keypair "$UPGRADE_KEY" \
        -u "$RPC" --use-rpc --max-sign-attempts 50 --with-compute-unit-price 1000 && break
      log "upgrade attempt $i failed; retrying"; sleep 30; done
  fi
else
  for i in 1 2 3; do
    solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" --upgrade-authority "$UPGRADE_KEY" --keypair "$UPGRADE_KEY" \
      -u "$RPC" --use-rpc --max-sign-attempts 50 --with-compute-unit-price 1000 && break
    log "deploy attempt $i failed; retrying (buffer reuse not attempted — recover with 'solana program show --buffers')"; sleep 30; done
fi
solana program show "$PROG" -u "$RPC" || { log "program not deployed — abort"; exit 4; }
assert_deployed_no_fixtures || { log "deployed program FAILED the fixture assert — abort bootstrap"; exit 4; }
pin_web_cluster apply | while read -r l; do log "$l"; done
# 2. bootstrap phase 1: TODAY's markets (DLV-118: expiry 16:00 ET today) + Debu wallet + wallet B + settler + pauser; books → pauser
if [ "$BOOTSTRAP_DAILY_MARKETS" = 1 ]; then
  if ! today_plan; then
    plan_refused "today's markets (no same-day session; never next-close books — rerun on the next trading day from 07:00 ET)"
    exit 7
  fi
  log "today's plan: $(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print(p["dateKey"],"close",p["closeTs"],[(m["symbol"],int(m["strikeE6"])/1e6,m["source"]) for m in p["markets"]],"refused",[r["symbol"] for r in p["refused"]])' "$TODAY_PLAN")"
else
  log "daily markets: OFF (BOOTSTRAP_DAILY_MARKETS=0) — the Railway worker is the only creator; phase 1 = wallets / mUSDC / settler / pauser / Config"
fi
b=$(bal); NB=$(nbooks "$b"); log "balance $b → NBOOKS=$NB (reserving ~1.7 SOL for the 20-min AAPL ATM book + 0.5 wallet-B fallback)"
( cd "$OPS_DIR" && TODAY_PLAN=$TODAY_PLAN RPC=$RPC STATE=$STATE NBOOKS=$NB SHORT_PHASE=skip DEBU_WALLET=$DEBU node devnet-bootstrap.cjs ) || { log "bootstrap failed"; exit 5; }
summary "bootstrap done (today's markets + wallets)"
handoff_repair 0 || true   # every book (incl. pre-!73 books) → pauser; ALERTs logged, pause watcher still starts
# 2b. pause watcher: every book in $STATE → Paused at its expiry (re-reads the state, so the 20-min book is covered too)
if [ -f "$PAUSER_KEY" ] && ! pauser_pin_ok; then
  log "[pause] ALERT pause watcher NOT started: $PAUSER_KEY is $PAUSER_PUB, not EXPECTED_PAUSER_PUB=$EXPECTED_PAUSER_PUB (staging.env)"
elif [ -f "$PAUSER_KEY" ]; then
  ( cd "$AUTO" && env -u SETTLER_KEYPAIR SOLANA_RPC_URL=$RPC SOLANA_CLUSTER=devnet PHOENIX_PAUSER_KEYPAIR=$PAUSER_KEY PAUSER_MUST_DIFFER_FROM=$PAUSER_MUST_DIFFER_FROM PHOENIX_PAUSE_LEAD_SECS=${PHOENIX_PAUSE_LEAD_SECS:-5} nohup node dist/ops-cli.js pause-watch --state "$STATE" >>"$PAUSE_LOG" 2>&1 & echo $! >"$PAUSE_LOG.pid" )
  log "pause watcher started (pid $(cat "$PAUSE_LOG.pid"), pauser $PAUSER_PUB, log $PAUSE_LOG)"
else log "WARNING no pauser key ($PAUSER_KEY) — Phoenix books will NOT be paused at expiry"; fi
# 3. e2e Buy Yes / Buy No through the web order path (today's books; cluster explicitly devnet)
if [ -n "$WEB_SRC" ] && [ -d "$WEB_SRC/node_modules" ]; then
  install -m 644 "$OPS_DIR/staging.e2e.test.ts" "$WEB_SRC/src/lib/phoenix/staging.e2e.test.ts"
  ( cd "$WEB_SRC" && STAGING_E2E=1 STAGING_STATE=$STATE VERIFY_WALLET=$K/trader.json RPC=$RPC CLUSTER=$WEB_CLUSTER NEXT_PUBLIC_SOLANA_CLUSTER=$WEB_CLUSTER \
    E2E_OUT=${E2E_OUT:-$RUN_TMP/e2e.json} npx vitest run src/lib/phoenix/staging.e2e.test.ts 2>&1 | grep -E '^\{|✓|✗|×|Tests|FAIL' )
else log "e2e skipped: WEB_SRC unset or has no node_modules"; fi
# 4. wait for Debu's START signal for the 20-min market (skip wait if it already exists in state, e.g. a rerun)
SKIP_SHORT=0
if python3 -c 'import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get("shortPlan") else 1)' "$STATE"; then
  log "20-min market already in state — resuming it (no START wait)"
else
  log "waiting for START signal for the 20-min AAPL ATM market: touch $START_FILE (or rerun with START_20M=now). Timeout ${START_WAIT_HOURS}h."
  sdl=$(( $(date +%s) + START_WAIT_HOURS*3600 )); n=0
  until [ "$START_20M" = now ] || [ -e "$START_FILE" ]; do
    [ "$(date +%s)" -gt $sdl ] && { log "no START signal within ${START_WAIT_HOURS}h — skipping the 20-min market"; SKIP_SHORT=1; state_set shortSkipped; break; }
    n=$((n+1)); [ $((n % 40)) = 0 ] && log "still waiting for START signal (touch $START_FILE)"; sleep 15; done
  [ -e "$START_FILE" ] && mv -f "$START_FILE" "$START_FILE.consumed-$(date +%Y%m%d-%H%M%S)"
  [ $SKIP_SHORT = 0 ] && log "START signal received — creating the 20-min market"
fi
if [ $SKIP_SHORT = 0 ]; then
  # 5. bootstrap phase 2: 20-min AAPL ATM market (strike from a fresh plan at START) with a Phoenix book + maker ladder + SM handoff
  today_plan || { plan_refused "20-min market at START (no same-day session)"; exit 6; }
  ( cd "$OPS_DIR" && TODAY_PLAN=$TODAY_PLAN RPC=$RPC STATE=$STATE NBOOKS=$NB SHORT_PHASE=only DEBU_WALLET=$DEBU node devnet-bootstrap.cjs ) || { log "20-min market bootstrap failed"; exit 6; }
  exp=$(python3 -c 'import json,sys;print([m for m in json.load(open(sys.argv[1]))["markets"] if m.get("short")][0]["expiryTs"])' "$STATE")
  SM=$(python3 -c 'import json,sys;print([m for m in json.load(open(sys.argv[1]))["markets"] if m.get("short")][0]["market"])' "$STATE")
  handoff_repair 0 || true   # the new 20-min book and every older book → pauser
  log "SHORT MARKET READY: $(python3 -c 'import json,sys;m=[m for m in json.load(open(sys.argv[1]))["markets"] if m.get("short")][0];print(m["symbol"],">=",m["strikeE6"]/1e6)' "$STATE") — trade until $(ct "$exp") (~$(( (exp - $(date +%s)) / 60 )) min left; UI closes 5 s early; book PAUSED at expiry); pull settle from $(ct $((exp+PULL_SETTLE_AFTER))), admin_settle fallback ~$(ct $((exp+SETTLE_AFTER)))"
  summary "20-min market live"
  # 6. short market: trader mints 5 pairs before expiry
  ( cd "$OPS_DIR" && RPC=$RPC STATE=$STATE node settle-test.cjs mint ) || log "[settle] ALERT trader mint failed on the 20-min market (settle/redeem proof will be incomplete)"
  # 6b. pause the 20-min book at expiry (foreground, deterministic; the background watcher is the backstop)
  while [ "$(date +%s)" -lt "$exp" ]; do sleep 5; done
  [ -f "$PAUSER_KEY" ] && { ops_cli pause-once --state "$STATE" || log "[pause] ALERT pause-once failed at expiry (the pause watcher keeps retrying)"; ops_cli_ro pause-status --state "$STATE" | grep -F '[20-min]'; }
  # 7. settle: permissionless Pyth pull settle (settler + Hermes key) first, admin_settle at the last published Pyth price as fallback
  while [ "$(date +%s)" -lt $(( exp + PULL_SETTLE_AFTER )) ]; do sleep 10; done
  SETTLE_OUT=$RUN_TMP/settle.out
  settled(){ grep -q "final status=[23]" "$SETTLE_OUT" 2>/dev/null; }
  while [ "$(date +%s)" -lt $(( exp + SETTLE_AFTER )) ]; do
    ( cd "$OPS_DIR" && RPC=$RPC STATE=$STATE node settle-test.cjs settle ) | tee "$SETTLE_OUT"; settled && break; sleep 30; done
  if ! settled; then
    # M3: never the stale pyth-read.py price. Hermes at expiry, else REFUSE and wait for a sourced operator price.
    AP=$(admin_price "$SM")
    if [ -z "$AP" ]; then
      log "[settle] ALERT admin_settle fallback REFUSED (no Hermes price at expiry). Write $ADMIN_PRICE_FILE with lines market=$SM price_e6=<integer micro-USD> source=<where from> — waiting up to ${OPERATOR_PRICE_WAIT_HOURS}h"
      odl=$(( $(date +%s) + OPERATOR_PRICE_WAIT_HOURS*3600 ))
      while [ -z "$AP" ] && [ "$(date +%s)" -lt $odl ]; do
        if [ -f "$ADMIN_PRICE_FILE" ]; then
          AP=$(eval "$(read_operator_price)"; admin_price "$SM")
          mv -f "$ADMIN_PRICE_FILE" "$ADMIN_PRICE_FILE.consumed-$(date +%Y%m%d-%H%M%S)"
          [ -z "$AP" ] && log "[settle] ALERT operator price in $ADMIN_PRICE_FILE REFUSED (see reason above) — write a corrected file"
        fi
        [ -z "$AP" ] && sleep 15
      done
    fi
    if [ -n "$AP" ]; then
      PX=${AP%%$'\t'*}; PSRC=${AP#*$'\t'}
      log "pull settle did not land by expiry+${SETTLE_AFTER}s — admin_settle fallback price AAPL e6=$PX source: $PSRC"
      for i in $(seq 1 15); do ( cd "$OPS_DIR" && RPC=$RPC STATE=$STATE ADMIN_PRICE_E6=$PX ADMIN_PRICE_SOURCE="$PSRC" ADMIN_PRICE_MARKET=$SM node settle-test.cjs settle ) | tee "$SETTLE_OUT"; settled && break; sleep 60; done
    else log "[settle] ALERT no admin_settle price within ${OPERATOR_PRICE_WAIT_HOURS}h — 20-min market left unsettled (settle manually)"; fi
  fi
  log "settle path: $(grep -oE 'PULL_SETTLE_OK via=[a-z]+|admin_settle price=[0-9.]+|admin_settle price source: .*' "$SETTLE_OUT" | tail -2 | tr '\n' ' ')"
  ( cd "$OPS_DIR" && RPC=$RPC STATE=$STATE node settle-test.cjs redeem )
fi
# 8. staging web lists real markets (no fixtures)
if [ -n "$WEB_URL" ]; then
  curl -sS -m 30 "$WEB_URL/markets" -o "$RUN_TMP/markets.html"
  log "fixture ids on /markets: $(grep -o 'fixture-[a-z0-9-]*' "$RUN_TMP/markets.html" | sort -u | wc -l); real market ids: $(python3 -c 'import json,sys;s=json.load(open(sys.argv[1]));h=open(sys.argv[2]).read();print(sum(m["market"] in h for m in s["markets"]))' "$STATE" "$RUN_TMP/markets.html")"
fi
log "settler $SETTLER_PUB SOL $(solana balance "$SETTLER_PUB" -u "$RPC" 2>/dev/null); pauser $PAUSER_PUB SOL $(solana balance "$PAUSER_PUB" -u "$RPC" 2>/dev/null)"
log "DONE payer left $(bal) SOL; Debu SOL $([ -n "$DEBU" ] && solana balance "$DEBU" -u "$RPC"); wallet B $WALLET_B_PUB SOL $(solana balance "$WALLET_B_PUB" -u "$RPC" 2>/dev/null)"
