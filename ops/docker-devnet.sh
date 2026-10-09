#!/usr/bin/env bash
# Devnet staging operator, run inside the Docker toolchain image (docker/toolchain.Dockerfile). This is how staging was
# deployed on 2026-10-08 (DEPLOY §5.4). Keys, state and secrets live in $SECRETS (a host folder mounted at /secrets),
# never in the repo.
#
#   docker run --rm -v <repo>:/repo -v <secrets>:/secrets -v <web node_modules vol>:/repo/apps/web/node_modules \
#     -v <automation node_modules vol>:/repo/apps/automation/node_modules meridian-toolchain:local \
#     bash /repo/ops/docker-devnet.sh <deploy|phase-a|phase-b|wait-phase-b>
#
#   deploy        build the prod .so (no fixtures), deploy/upgrade it, dump it back and assert it is fixture-free
#   phase-a       Config, mUSDC, keeper/maker/trader/settler/pauser + tester wallet funding (no markets)
#   phase-b       today's (ET) markets + Phoenix books + seat-manager handoff to the pauser + maker ladders,
#                 strikes ATM on the operator prior closes in $SECRETS/state/strike-prices.json (D-026)
#   wait-phase-b  sleep until 00:05 ET of the next ET day, then phase-b (run it detached the evening before)
#
# $SECRETS layout: env (DEVNET_RPC_URL=...; optional TESTER_WALLET, TESTER_SOL, WALLET_B_SOL), keys/devnet/*.json
# (upgrade-authority, program, keeper, admin, maker, trader, usdc-mint, wallet-b, settler, pauser), state/.
set -euo pipefail
S=${SECRETS:-/secrets}
set -a; . "$S/env"; set +a
: "${DEVNET_RPC_URL:?set DEVNET_RPC_URL in $S/env (a dedicated devnet RPC; the public one rate-limits deploys)}"
RPC=$DEVNET_RPC_URL; export RPC
export KEYS=$S/keys/devnet STATE=$S/state/devnet-state.json
export MERIDIAN_PROGRAM_ID=${MERIDIAN_PROGRAM_ID:-$(solana-keygen pubkey "$KEYS/program.json")}
export WEB_NODE_MODULES=/repo/apps/web/node_modules/ MERIDIAN_IDL=/repo/idl/meridian.prod.json
export SETTLER_KEY=$KEYS/settler.json PAUSER_KEY=$KEYS/pauser.json WALLET_B_KEY=$KEYS/wallet-b.json
export DEBU_WALLET=${TESTER_WALLET:-} DEBU_SOL=${TESTER_SOL:-0.5} WALLET_B_SOL=${WALLET_B_SOL:-0.2}
export ADMIN_SETTLE_DELAY_SECS=${ADMIN_SETTLE_DELAY_SECS:-60} PYTH_REF_SHARD=1 AIRDROP_RPC=$RPC
# D-019 MAG7 Pyth feed ids (SCHEMA §3.1)
export PYTH_FEED_IDS='{"AAPL":"49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688","MSFT":"d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1","GOOGL":"5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6","AMZN":"b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a","NVDA":"b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593","META":"78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe","TSLA":"16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1"}'
redact(){ sed -u "s#api-key=[^ \"&]*#api-key=***#g"; }
log(){ echo "[devnet-ops $(TZ=America/New_York date '+%F %T ET')] $*"; }
payer_sol(){ solana balance "$KEYS/upgrade-authority.json" -u "$RPC" | awk '{print $1}'; }
# books the payer can afford: 1.18 SOL rent per Phoenix book (232,544 bytes) + ~0.02 maker ATAs/seat, 0.3 SOL kept back
nbooks(){ payer_sol | awk '{n=int(($1-0.3)/1.2); if(n>7)n=7; if(n<0)n=0; print n}'; }
cd /repo
mkdir -p /root/.config/solana "$S/state"; cp "$KEYS/upgrade-authority.json" /root/.config/solana/id.json

deploy(){
  log "deploy: prod .so (no features) → $MERIDIAN_PROGRAM_ID"
  cargo build-sbf --manifest-path programs/meridian/Cargo.toml --sbf-out-dir /tmp/prod 2>&1 | grep -E "error|Finished" || true
  bash scripts/assert-prod-no-fixtures.sh /tmp/prod/meridian.so idl/meridian.prod.json
  solana program deploy /tmp/prod/meridian.so -u "$RPC" --program-id "$KEYS/program.json" \
    --keypair "$KEYS/upgrade-authority.json" --upgrade-authority "$KEYS/upgrade-authority.json" --max-sign-attempts 60 2>&1 \
    | grep -vE "seed phrase|^[a-z]+( [a-z]+){11}$" | redact
  solana program dump "$MERIDIAN_PROGRAM_ID" /tmp/prod/deployed.so -u "$RPC" >/dev/null
  bash scripts/assert-prod-no-fixtures.sh /tmp/prod/deployed.so idl/meridian.prod.json
  log "deploy done; payer $(payer_sol) SOL"
}
build_ops(){ [ -f apps/automation/dist/ops-cli.js ] || (cd apps/automation && npm run -s build); }
phase_a(){ build_ops; log "phase A"; (cd ops && SHORT_PHASE=skip BOOTSTRAP_DAILY_MARKETS=0 node devnet-bootstrap.cjs) 2>&1 | redact; }
phase_b(){
  build_ops
  local nb=${NBOOKS:-$(nbooks)}
  log "phase B: payer $(payer_sol) SOL -> NBOOKS=$nb; today's plan from the operator prior closes"
  (cd apps/automation && OPERATOR_STRIKE_PRICES_FILE=$S/state/strike-prices.json SOLANA_CLUSTER=devnet SOLANA_RPC_URL=$RPC \
     STRIKE_OFFSETS_E6=0 node dist/ops-cli.js market-day --strikes) > "$S/state/today-plan.json"
  cat "$S/state/today-plan.json"; echo
  (cd ops && TODAY_PLAN=$S/state/today-plan.json SHORT_PHASE=skip BOOTSTRAP_DAILY_MARKETS=1 NBOOKS=$nb node devnet-bootstrap.cjs) 2>&1 | redact
  log "phase B done; payer $(payer_sol) SOL"
}
case "${1:-}" in
  deploy) deploy;;
  phase-a) phase_a;;
  phase-b) phase_b;;
  wait-phase-b)
    target=$(TZ=America/New_York date -d "tomorrow 00:05" +%s); log "sleeping until $(TZ=America/New_York date -d @"$target" '+%F %T ET')"
    while [ "$(date +%s)" -lt "$target" ]; do sleep 60; done; phase_b;;
  *) echo "usage: docker-devnet.sh deploy|phase-a|phase-b|wait-phase-b"; exit 2;;
esac
