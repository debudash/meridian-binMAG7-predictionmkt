#!/usr/bin/env bash
# Meridian local test instance (one container = one network namespace, so 127.0.0.1 means the same thing to the
# validator, the seed scripts and the Next.js server). Steps:
#   1. keys      authority / maker / dev wallet under /data/keys (created once, never leave the volume)
#   2. program   localnet-test build of programs/meridian (skipped when the .so exists; REBUILD=1 forces)
#   3. phoenix   Phoenix V1 + Seat Manager .so dumped once from mainnet into /data/programs
#   4. chain     solana-test-validator on :8899 with all three programs preloaded (RESET=1 wipes the ledger)
#   5. seed      config + USDC + dev wallet + 7 MAG7 markets with Phoenix books and a maker ladder
#   6. web       next dev on 127.0.0.1:3000, relayed to :3001 for the Windows port mapping (see docker/README.md)
set -euo pipefail
cd /repo
export HOME=/root
DATA=/data
KEYS=$DATA/keys
mkdir -p "$KEYS" "$DATA/programs" "$DATA/state" "$DATA/ledger" /root/.config/solana
log() { echo "[meridian-local] $*"; }

# 1. keys
for k in authority maker devwallet; do
  [ -f "$KEYS/$k.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYS/$k.json"
  chmod 600 "$KEYS/$k.json"
done
ln -sf "$KEYS/authority.json" /root/.config/solana/id.json
solana config set --url http://127.0.0.1:8899 >/dev/null

# node deps (named volumes, Linux binaries)
[ -d node_modules/@coral-xyz ] || { log "npm install (root)"; npm install --no-audit --no-fund; }
[ -d apps/web/node_modules/next ] || { log "npm install (web)"; npm install --prefix apps/web --no-audit --no-fund; }
[ -d apps/automation/node_modules/typescript ] || { log "npm install (automation)"; npm install --prefix apps/automation --no-audit --no-fund; }
npm run build --prefix apps/automation >/dev/null

# 2. program (localnet-test build; the prod build never goes on this validator's twin on devnet)
if [ ! -f target/deploy/meridian.so ] || [ "${REBUILD:-0}" = "1" ]; then
  log "anchor build --features localnet-test (first run takes a while)"
  anchor build -- --features localnet-test
fi

# 3. Phoenix programs from mainnet (read-only dump; same programs devnet/mainnet run)
for p in "phoenix:PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY" "seat_manager:PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1"; do
  name=${p%%:*}; id=${p##*:}
  [ -s "$DATA/programs/$name.so" ] || { log "dumping $name ($id) from mainnet"; solana program dump -u "${MAINNET_RPC:-https://api.mainnet-beta.solana.com}" "$id" "$DATA/programs/$name.so"; }
done

# 4. validator
RESET_FLAG=""
if [ "${RESET:-0}" = "1" ]; then RESET_FLAG="--reset"; rm -f "$DATA/state/"*.json; fi
log "starting solana-test-validator on :8899 ${RESET_FLAG}"
solana-test-validator --ledger "$DATA/ledger" $RESET_FLAG --quiet \
  --rpc-port 8899 --bind-address 0.0.0.0 \
  --bpf-program 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6 target/deploy/meridian.so \
  --bpf-program PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY "$DATA/programs/phoenix.so" \
  --bpf-program PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1 "$DATA/programs/seat_manager.so" \
  > "$DATA/validator.log" 2>&1 &
VALIDATOR=$!
for i in $(seq 1 60); do solana cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana cluster-version >/dev/null || { log "validator did not start; see /data/validator.log"; tail -30 "$DATA/validator.log"; exit 1; }

# 5. seed (idempotent: re-running on an existing ledger only adds what's missing)
node docker/localnet/seed.cjs

# 6. web
USDC_MINT=$(node -e 'console.log(require("/data/state/local.json").usdcMint)')
export NEXT_PUBLIC_SOLANA_CLUSTER=localnet NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899 \
  NEXT_PUBLIC_MERIDIAN_PROGRAM_ID=9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6 NEXT_PUBLIC_USDC_MINT=$USDC_MINT \
  NEXT_PUBLIC_PHOENIX_ENABLED=true NEXT_PUBLIC_PHOENIX_PROGRAM_ID=PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY \
  NEXT_PUBLIC_LOCALNET_DEV_WALLET=true LOCALNET_DEV_WALLET_KEYPAIR=$KEYS/devwallet.json \
  NEXT_PUBLIC_EXPLORER_URL="https://explorer.solana.com/?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"
log "web: next dev on 127.0.0.1:3000 → open http://localhost:3000 on Windows"
(cd apps/web && PORT=3000 npx next dev -H 127.0.0.1 -p 3000) &
WEB=$!
# Relay inside the namespace: Docker's port mapping lands on :3001 and is forwarded to 127.0.0.1:3000, so Next sees a
# loopback peer and the dev-wallet gates (DLV-080/081) hold. Published on Windows 127.0.0.1 only (compose file).
socat TCP-LISTEN:3001,fork,reuseaddr TCP:127.0.0.1:3000 &
log "ready. settle expired markets: docker compose -f docker/compose.localnet.yml exec local node docker/localnet/settle.cjs"
wait -n "$VALIDATOR" "$WEB"
