# Railway staging checklist (Meridian)

Specs: [`DEPLOY.md`](DEPLOY.md) §4 · healthchecks already in package `railway.json`.

## 0. Current staging (DLV-077, 2026-10-07)

Debu asked for staging on 2026-10-07 and supplied a Railway workspace token (stored on the ops box only, never in git). Ladder position: **localnet ✅ → devnet program ⏳ (funding) → Railway staging ✅ (services up) → Railway prod ✗ (not started)**.

| Item | Value |
| --- | --- |
| Railway project | `meridian-staging` (workspace "Debu Dash's Projects", PRO plan; Railway's default environment is named `production` — it is the staging env) |
| Web | service `web`, `rootDirectory`-equivalent upload of `apps/web` via `railway up`, **https://web-production-77fbb.up.railway.app** (`/api/health` → 200) |
| Automation | service `automation` (`apps/automation`, `node dist/worker.js`, calendar mode, Railway healthcheck `/health` green, no public domain) |
| Helper | service `devnet-faucet` — retries public devnet `requestAirdrop` for the staging payer (box egress to `api.devnet.solana.com` is blocked); exits when funded/timed out |
| Deploy method | `railway up` from a `git archive` of `main` (Railway has no GitLab integration). Redeploy = re-run from the new tip. Builder: Railpack (Railway ignores the `NIXPACKS` hint) |
| Cluster / RPC | devnet, `https://api.devnet.solana.com` (web + automation) |
| Program id | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` — canonical id reused on devnet; **prod build** (`anchor build`, no features; `assert-prod-no-fixtures` green) |
| Upgrade authority | staging-only key `2DTwL4KoEoGgThD6xRKtms26invuVGgh6sL8hbonkzpa` (box, outside repo) |
| Config authority / keeper | `CCt1MZ5GPYskDBjSDfknkamesGufsJFk2yFzXNvV5dst` = `AUTOMATION_KEYPAIR` (Railway secret variable only) |
| Collateral | staging test mint "mUSDC" `GEBRsT3Nc3PaEio2qf3x4JUgFtPSYXr7bmVitMuzMBXq` (6 dp; mint authority = box-only admin key) |
| Config params | fees 0/0 bps, `settle_max_staleness_slots` 150, `settle_max_conf_ratio_bps` 200, `admin_settle_delay_secs` **300** (staging only) |
| Phoenix | V1 `PhoeNiXZ8…` + Seat Manager `PSMxQb…` (both live on devnet); Yes/USDC books (512/512/1153, tick $0.01, 1 lot = 1 contract, 0 bps) with authority handed to PSM so any wallet can ClaimSeat |
| Markets (planned) | AAPL ≥ 305, NVDA ≥ 210, TSLA ≥ 365, MSFT ≥ 495 expiring Fri 2026-10-09 16:00 ET (books on the first 1–3 depending on SOL), plus AAPL ≥ 300 expiring ~20 min after bootstrap for the settle check |
| Dev wallet | **off** (`NEXT_PUBLIC_LOCALNET_DEV_WALLET` unset; `/api/localnet-dev-wallet` → 404 verified) |

### Blocker: devnet SOL

The devnet program and books need ≈13 SOL (program ≈2.7 SOL rent + ≈2.7 transient buffer, ≈1.65 SOL rent per Phoenix book, 2 SOL for Debu's Phantom). Public `requestAirdrop` returns 429 "airdrop limit today" from both the ops box and Railway; the PoW faucet needs SOL for fees; web faucets need a GitHub login. Until the payer is funded, the program is not on devnet and **the web falls back to fixture markets** (banner shown). Fund `2DTwL4KoEoGgThD6xRKtms26invuVGgh6sL8hbonkzpa` (e.g. faucet.solana.com, 2 × 5 SOL with GitHub); a box pipeline (`run-staging.sh`) then deploys, bootstraps books, funds Debu's wallet, runs Buy Yes / Buy No and the short-expiry settle check without further Railway changes (all env is already final).

### Findings from the dry run (prod `.so` on an isolated validator with devnet Phoenix/PSM and cloned devnet Pyth accounts)

- ✅ init_config, create_strike_market, Phoenix create → PSM authority → set_phoenix_market, maker mint + ladder, **Buy Yes** (phoenix-only) and **Buy No** (mint-then-ask) through the web's `fetchMarketViaRpc → placePhoenixOrder` path.
- ❌ **Permissionless settle with real Pyth fails: `InvalidPythAccount` (pyth.rs, prod decoder).** The prod build decodes the *legacy* Pyth `Price` layout (magic `0xa1b2c3d4`, ≥240 bytes) but the D-019 accounts are receiver `PriceUpdateV2` accounts (134 bytes). Prod/mainnet blocker — program fix needed (decode PriceUpdateV2 + owner check `rec5EK…` + feed-id compare + publish-time staleness).
- ⚠️ The D-019 shard-0 MAG7 accounts are **stale** on both clusters (2026-10-07: devnet AAPL/MSFT/NVDA/GOOGL/AMZN/META ≈97 days, TSLA ≈35 h; mainnet ≈26–54 days). A settler must post fresh updates (Hermes `/v2/updates` is now API-key gated) or Pyth must re-sponsor; re-pin per SCHEMA §3.1 caveat.
- Staging settlement therefore uses **admin_settle** (Policy A consistent price) after `admin_settle_delay_secs`; automation's real-Pyth settle attempts will log `InvalidPythAccount` until the program fix lands.
- ⚠️ Web falls back to fixtures whenever RPC GPA fails or is empty, on any cluster. For prod, disable the fixture fallback off-localnet.

### Box-side ops (not in git; keys `chmod 600` under `/workspace/meridian-staging-keys/`)

`/workspace/meridian-staging-ops/`: `devnet-bootstrap.cjs` (idempotent bootstrap), `settle-test.cjs` (mint / settle / redeem on the short market), `run-staging.sh` (wait for SOL → deploy → bootstrap → e2e → settle). State: `/workspace/meridian-staging-state.json`.

## 1. Connect project

1. Create / open a Railway **staging** project (done 2026-10-07: `meridian-staging`, see §0).
2. Link the GitLab repo `debudash/peak6-meridian` (or deploy from `main`).
3. Add **two** services from the monorepo:

| Service | `rootDirectory` | Config | Health |
| --- | --- | --- | --- |
| **web** | `apps/web` | [`apps/web/railway.json`](../apps/web/railway.json) | `/api/health` |
| **automation** | `apps/automation` | [`apps/automation/railway.json`](../apps/automation/railway.json) | `/health` |

## 2. Set variables from templates

Copy placeholders — **no real secrets in git**:

- Web: [`apps/web/.env.railway.staging.example`](../apps/web/.env.railway.staging.example)  
  (mirror: `deploy/railway/web.staging.env.example`)
- Automation: [`apps/automation/.env.railway.staging.example`](../apps/automation/.env.railway.staging.example)  
  (mirror: `deploy/railway/automation.staging.env.example`)

Required highlights:

| Var | Notes |
| --- | --- |
| `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID` / `MERIDIAN_PROGRAM_ID` | `9Rb7nx…` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` / `SOLANA_RPC_URL` | Devnet RPC |
| `NEXT_PUBLIC_USDC_MINT` / `COLLATERAL_MINT` | Devnet USDC |
| `PYTH_PRICE_FEEDS` | Devnet Pyth accounts (automation) |
| `PHOENIX_MARKETS` / `NEXT_PUBLIC_PHOENIX_*` | Devnet Phoenix market wiring |
| `AUTOMATION_KEYPAIR` | **Railway secret only** |
| `NEXT_PUBLIC_INDEXER_URL` | Optional; empty → RPC GPA → fixtures |

## 3. IDL bake (automation)

Before/with deploy, ensure prod IDL is in-package:

```bash
yarn build:prod-idl
yarn assert:idl-sync
```

`MERIDIAN_IDL_PATH=idl/meridian.prod.json` (under `apps/automation`).

## 4. Verify

- [ ] Web health `GET /api/health` 200
- [ ] Automation health `GET /health` 200
- [ ] No `ANCHOR_FEATURES=localnet-test` / no `MODE=sim` on Railway
- [ ] Program id matches on-chain deploy
- [ ] Keypairs only in Railway secrets

## 5. Out of scope here

- Creating the Railway **prod** project
- Deploying the Solana program
- Committing secrets
