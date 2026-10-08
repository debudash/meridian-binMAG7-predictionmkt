# Meridian deployment guide

How to run Meridian locally, deploy the program to devnet, run the Railway staging services and operate them day to day.

Parts:

| Part | Runs where | Deployed with |
| --- | --- | --- |
| Anchor program `programs/meridian` | Solana cluster | Solana CLI (never Railway) |
| Web app `apps/web` (Next.js) | Railway service `web` | `railway up` |
| Automation worker `apps/automation` (Node) | Railway service `automation` | `railway up` |
| Operator scripts `ops/` | Operator box | Run by hand or by `ops/run-staging.sh` |

**Program id:** see `Anchor.toml` and `declare_id!` in `programs/meridian/src/lib.rs`. It was rotated on 2026-10-08 because the old program keypair was lost with the old build box (DLV-124); the staging value is in §5.3. Key policy: [`keys/README.md`](../keys/README.md).

---

## 1. Environment ladder

| Stage | Cluster | Program build | Oracle | Phoenix | App hosting | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Local (Docker or manual) | `solana-test-validator` | `localnet-test` | Mock Pyth (`upsert_mock_pyth`) | Real Phoenix V1 + Seat Manager loaded into the validator | `localhost:3000` | Working |
| Devnet staging | devnet | prod (`yarn build:prod`) | Pyth pull oracle (D-025) or operator price (see §6) | Phoenix V1 on devnet | Railway staging | Services up; program + markets not yet bootstrapped (DLV-077) |
| Mainnet | mainnet-beta | prod | Pyth pull oracle | Phoenix V1 | Railway prod | Not started (out of V1 scope) |

Order: local green → prod `.so` fixture assert → devnet program → Railway staging → (later) Railway prod.

## 2. Hard rule: `localnet-test` never leaves localnet

`--features localnet-test` compiles test-only instructions into the program: `upsert_mock_pyth`, `test_drain_vault` (can empty a vault), `sim_open_session` / `sim_close_session` and the SimClock instructions.

| Cluster | Allowed build |
| --- | --- |
| Local validator / CI test job | `yarn build:localnet` or `yarn test` (= `anchor test -- --features localnet-test`) |
| Devnet, mainnet | `yarn build:prod` only |

`yarn build:prod` = `anchor build` (no features) → `scripts/emit-prod-idl.js` (writes `idl/meridian.prod.json` and the copies in `apps/web` and `apps/automation`) → `scripts/assert-prod-no-fixtures.sh` (fails if any fixture name is in the `.so` or the prod IDL). Web and automation load `meridian.prod.json` only; the automation client refuses a fixture IDL when `SOLANA_CLUSTER` is not `localnet`.

## 3. Local

### 3.1 Docker (anytime demo)

```bash
docker compose -f docker/compose.localnet.yml up --build
# open http://127.0.0.1:3000
```

Brings up a local validator with the localnet-test program and the web app, with no Solana toolchain on the host. Use `127.0.0.1`, not `localhost` (another app on `[::]:3000` can capture `localhost`). The validator container runs with `seccomp:unconfined` because Agave 4.x needs io_uring, which Docker's default seccomp profile blocks; local dev container only. The same image runs every suite (`docker compose … run --rm local bash -lc "<command>"`). What it seeds, ports and troubleshooting: [`docker/README.md`](../docker/README.md).

### 3.2 Manual

Use the Docker path (§3.1) unless you need to work on the toolchain itself. Prerequisites (same as the Docker toolchain image): Rust 1.85, Solana / Agave CLI 4.3.0, Anchor 0.31.1 (`Anchor.toml`), Node ≥ 20 (the image uses 22), yarn.

```bash
yarn install
yarn test                                   # full localnet suite (builds with localnet-test)
yarn build:prod                             # prod build + fixture assert
```

Run the app against a local validator:

```bash
solana-test-validator --reset               # in another terminal; deploy the localnet-test build to it
(cd apps/automation && npm install && npm run build)
RPC=http://127.0.0.1:8899 MERIDIAN_IDL=target/idl/meridian.json \
  node scripts/localnet/today-markets.cjs   # today's 7 MAG7 markets, each with a Phoenix book + maker ladder
cp apps/web/.env.example apps/web/.env.local   # set the NEXT_PUBLIC_* values
npm run web:dev                             # binds 127.0.0.1:3000
```

- Before `today-markets.cjs`: the validator must have the Phoenix V1 and Seat Manager programs loaded (e.g. `--bpf-program` / `--clone` from mainnet dumps), `apps/web/node_modules` must be installed (the script uses its web3 / Phoenix SDK packages), and `MAKER` / `STATE_OUT` must be set, because their defaults point at `/workspace` paths on the old build box.
- `today-markets.cjs` is additive and idempotent, localnet only, and refuses after that day's 16:00 ET close (exit 3). See [`scripts/localnet/README.md`](../scripts/localnet/README.md).
- The Localnet Dev Wallet (sign without Phantom) is described in [`apps/web/README.md`](../apps/web/README.md). It is off in every production build and on any non-loopback server.

### 3.3 One-command sim lifecycle (D-017)

Runs create → open → mint → close → settle → redeem on a local validator without waiting for 9:30 / 16:00 ET.

```bash
yarn automation:sim     # = npm run sim-lifecycle --prefix apps/automation
```

Env (see `apps/automation/.env.example`, sim section): `MODE=sim`, `SOLANA_CLUSTER=localnet`, `SOLANA_RPC_URL=http://127.0.0.1:8899`, `MERIDIAN_IDL_PATH=idl/meridian.json` (full localnet IDL), `AUTOMATION_KEYPAIR`, optional `SETTLER_KEYPAIR`, `COLLATERAL_MINT`, `STRIKE_SYMBOLS`.

Isolation: `dist/worker.js` (Railway) never imports the sim module and uses the prod IDL; `dist/sim-lifecycle.js` is the only entry that does. The worker refuses `MODE=sim`. Never set `MODE=sim` or `ANCHOR_FEATURES=localnet-test` on Railway.

## 4. Devnet program deploy

```bash
yarn build:prod
solana config set --url https://api.devnet.solana.com
solana program deploy target/deploy/meridian.so \
  --program-id target/deploy/meridian-keypair.json \
  --upgrade-authority <upgrade-authority keypair path> \
  --url devnet
```

- The program keypair and the upgrade key live on the operator box only (`chmod 600`), never in git and never on Railway.
- After deploy, check the deployed binary: `solana program dump -u devnet <program id> /tmp/m.so && bash scripts/assert-prod-no-fixtures.sh /tmp/m.so idl/meridian.prod.json`.
- Then bootstrap (§5.4): Config, collateral mint, markets, Phoenix books. Never call mock / sim / drain instructions (they are not in the prod `.so`).
- Devnet funding: see §5.3.

## 5. Railway staging

### 5.1 Services

| Service | Root | Config | Build | Start | Health |
| --- | --- | --- | --- | --- | --- |
| `web` | `apps/web` | [`apps/web/railway.json`](../apps/web/railway.json) | `npm install && npm run build` | `npm run start` | `GET /api/health` |
| `automation` | `apps/automation` | [`apps/automation/railway.json`](../apps/automation/railway.json) | `npm install && npm run build:railway` | `node dist/worker.js` | `GET /health` (`HEALTH_PORT` / `PORT`, default 8080) |

- Railway project `meridian-staging` (its default environment is named `production`; it is the staging environment). Web: https://web-production-77fbb.up.railway.app.
- Railway has no GitLab integration here. Deploy with `railway up` from a `git archive` of the `main` commit you want, per service. Railway builds with Railpack and ignores the `NIXPACKS` hint.
- `build:railway` leaves the sim entry out of `dist/`. Before deploying automation, bake the prod IDL into the package: `yarn build:prod-idl && yarn assert:idl-sync`.

### 5.2 Environment variables (names only)

Set secrets only as Railway variables. Templates: [`apps/web/.env.railway.staging.example`](../apps/web/.env.railway.staging.example), [`apps/automation/.env.railway.staging.example`](../apps/automation/.env.railway.staging.example) (mirrors in `deploy/railway/`).

**web**

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet`, set explicitly. Never `custom` on staging |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Devnet RPC |
| `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID` | Deployed program id |
| `NEXT_PUBLIC_USDC_MINT` | Staging collateral mint (test "mUSDC", 6 decimals) |
| `NEXT_PUBLIC_EXPLORER_URL`, `NEXT_PUBLIC_PHOENIX_ENABLED`, `NEXT_PUBLIC_PHOENIX_PROGRAM_ID`, `NEXT_PUBLIC_INDEXER_URL` | Optional |

No private key ever goes in a `NEXT_PUBLIC_*` variable. `NEXT_PUBLIC_LOCALNET_DEV_WALLET` stays unset.

**automation**

| Variable | Secret? | Notes |
| --- | --- | --- |
| `SOLANA_RPC_URL`, `SOLANA_CLUSTER`, `MERIDIAN_PROGRAM_ID`, `MERIDIAN_IDL_PATH` | RPC URL if keyed | `MERIDIAN_IDL_PATH=idl/meridian.prod.json` |
| `MODE` | no | `calendar` (default) |
| `COLLATERAL_MINT`, `STRIKE_SYMBOLS` | no | All seven MAG7 for the PRD (staging is set to `AAPL` today) |
| `PYTH_FEED_IDS`, `PYTH_PRICE_FEEDS`, `PYTH_HERMES_URL` | no | Feed ids are required off-localnet (D-025) |
| `PYTH_HERMES_API_KEY` | **yes** | Hermes is key-gated. The current key lacks the equity entitlement (DLV-106) |
| `AUTOMATION_KEYPAIR` | **yes** | Config authority: create markets, `set_phoenix_market`, `admin_settle` |
| `SETTLER_KEYPAIR` | **yes** | Low-balance key that signs and pays for permissionless `settle`. Must differ from the authority; required on mainnet |
| `PHOENIX_PAUSER_KEYPAIR` | **yes** | Seat Manager authority of each book; pauses books at expiry. Not pause-only (it can also unpause and move authority), so treat a leak as an incident: [`runbooks/PAUSER_ROTATION.md`](runbooks/PAUSER_ROTATION.md) |
| `PHOENIX_PAUSE_LEAD_SECS` (staging 5), `PHOENIX_PAUSE_ALERT_SECS`, `PHOENIX_PAUSE_ALERT_REPEAT_SECS` | no | Pause timing and alert repeat |
| `OPERATOR_STRIKE_PRICES`, `OPERATOR_CLOSE_PRICES` | no | Operator prices (§6.2). Set with `ops/operator-prices.cjs` |
| `CREATE_FROM_ET`, `CREATE_DEADLINE_ET`, `PRIOR_CLOSE_MAX_SKEW_SECS` | no | Create window 07:00, deadline 08:00, prior-close skew 300 s (D-026). Keep comments on their own line: Railway takes everything after `=` as the value |
| `PHOENIX_MARKETS` | no | Keep empty; ignored for daily markets |
| `SETTLE_POLL_MS`, `SETTLE_MAX_RETRIES`, `ADMIN_SETTLE_AFTER_RETRIES`, `WORKER_TICK_MS`, `LOG_LEVEL`, `HEALTH_PORT` | no | Tuning |

The upgrade key never goes on Railway.

### 5.3 Staging environment (public values)

Staging was re-bootstrapped on 2026-10-08 with new keys and a new program id (DLV-124). Test plans refer to this table instead of hard-coding addresses. Public keys only, never secret bytes.

| Role | Value |
| --- | --- |
| Program id | `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` (deployed 2026-10-08, slot 508961032, built with Agave 4.3.0; deployed binary checked fixture-free) |
| Upgrade authority / payer (`upgrade-authority.json`) | `Fm34E3zi5QBLxC2QFWvjGkcN2D4i3RmgUwvcFhjF9XVo` |
| Keeper = config authority (`AUTOMATION_KEYPAIR`) | `2eVbj2kCe9AanuqHUA6BWXnm74dSMxBisCdZtBDQXui9` |
| Settler (`SETTLER_KEYPAIR`) | `HHudnrhF6XkfSZNAa3TnvuTKCqKhfGh8qA2JoFmVwNr7` |
| Pauser (`PHOENIX_PAUSER_KEYPAIR`, = `EXPECTED_PAUSER_PUB`) | `97RhBfsbKVkRD6u8tdmnrTUPNSbyvqQASCBVBXJmL9AQ` |
| Collateral: test mint "mUSDC", 6 decimals, mint authority (`admin`) on the operator PC only | `6U34yus6KeBUduvfdw8eR7QrKzpah3sqhMCc4R9ZJLHh` |
| Config values (`ops/devnet-bootstrap.cjs`) | fees 0 / 0 bps · `settle_max_staleness_slots` 150 · `settle_max_conf_ratio_bps` 200 · `admin_settle_delay_secs` 60 (`ADMIN_SETTLE_DELAY_SECS`, the program's production minimum; DLV-123) |
| Phoenix | V1 `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` + Seat Manager; tick $0.01, 1 lot = 1 contract, 0 bps |
| Railway services | `web` (URL above), `automation` (no public domain); in the 2026-10-07 setup also a `devnet-faucet` helper that retried public `requestAirdrop` for the payer and exited when funded or timed out (confirm whether it still exists) |
| Tester wallet funding | bootstrap sends the tester's Phantom wallet `DEBU_SOL` (default 2; 0.5 used) SOL + 10,000 mUSDC; wallet B `WALLET_B_SOL` (0.2 used) + 1,000 mUSDC |
| Reference Pyth feeds | devnet shard-1 sponsored accounts (`PYTH_REF_SHARD=1`), fresh on devnet; display only, settle never trusts the address |
| RPC | dedicated devnet RPC (Helius) on both services; the public endpoint rate-limits program deploys and polling (429) |

**Devnet funding.** The payer needs about **13 SOL**: program rent ≈ 2.7 SOL + a transient upgrade buffer ≈ 2.7 SOL, ≈ 1.18 SOL rent per Phoenix book (232,544-byte market account), and 2 SOL for the tester's wallet. `run-staging.sh` waits until the payer holds at least `MIN_SOL` (default **9**) before it starts and creates fewer books on a smaller balance. Public `requestAirdrop` is rate-limited (429); fund the payer from a faucet first.

**Pyth accounts.** The D-019 shard-0 MAG7 push accounts are stale on both clusters; devnet shard-1 accounts were fresh when checked (SCHEMA §3.1.1). Settlement does not depend on them: the settler posts the expiry price (§6.3).

### 5.4 Bootstrap from the operator box

The operator scripts in [`ops/`](../ops/README.md) hold no keys or box paths; everything comes from env or an untracked `ops/staging.env` (template `ops/staging.env.example`).

`ops/run-staging.sh` runs the whole pipeline (`DRY_RUN=1` prints the plan with zero transactions):

1. Wait for the payer's devnet SOL.
2. Prod build of `origin/main`, deploy or upgrade, deployed-binary fixture assert.
3. `ops/devnet-bootstrap.cjs` (idempotent): mUSDC mint, Config, Phoenix books + maker ladder, wallet / settler / pauser funding, and the Seat Manager handoff of every book to the pauser.
4. Pause watcher, web order-path e2e, then a short 20-minute AAPL market on the operator's START signal to check pause → settle → redeem.

Key roles (all `chmod 600`, never in git): the full table is in [`ops/README.md`](../ops/README.md#keys-never-committed-chmod-600).

| Key | Role | Lives on |
| --- | --- | --- |
| upgrade authority | Program upgrades, payer, Phoenix book creator | Operator box only |
| keeper | Config authority | Box + Railway `AUTOMATION_KEYPAIR` |
| settler | Permissionless settle signer and payer | Box + Railway `SETTLER_KEYPAIR` |
| pauser | Phoenix Seat Manager authority after handoff | Box + Railway `PHOENIX_PAUSER_KEYPAIR` + offline backup |

## 6. Daily operation (staging)

### 6.1 Market creation and daily timing (D-026)

| When (ET) | What |
| --- | --- |
| Previous session's close (16:00, or 13:00 after an early close) → 08:00 | Operator strike prices can be set (§6.2) |
| From 07:00 | The worker's create window opens (`CREATE_FROM_ET`) |
| By 08:00 | Every MAG7 market for the day must exist (`CREATE_DEADLINE_ET`). If not, the worker logs `ALERT create deadline 08:00 ET missed …` once that day and keeps retrying until 16:00 |
| 09:30–16:00 | PRD trading session; expiry = that day's 16:00 ET close. There is no on-chain 09:30 gate: markets can be minted and traded from creation |
| 16:00 → 16:05 | Pause books, settle (§6.3–§6.4) |

- One creator: the Railway `automation` worker creates each trading day's MAG7 markets (`BOOTSTRAP_DAILY_MARKETS=0` on the box).
- Strike = ATM on the **previous trading day's close** (13:00 ET after an early close). Reference, in order: the Hermes price at that close (publish time within `PRIOR_CLOSE_MAX_SKEW_SECS`, default 300 s) → a receiver-owned, Full-verified `PYTH_PRICE_FEEDS` account posted at that close → the operator prior closes (§6.2) → otherwise no market and an `ALERT`.
- Weekends, NYSE holidays and NYSE early-close days (no market created that day; 13:00 handling is a mainnet Todo) are refused with an `ALERT`. After the close the worker never creates (no roll to the next day).
- Known gap: worker-created markets have no Phoenix book yet (mint / redeem / settle work; book trading needs the bootstrap books). Keep `PHOENIX_MARKETS` empty.

### 6.2 Operator prices (while DLV-106 is open)

The current Hermes key returns 403 for equity feeds, so staging uses operator-sourced prices with a logged source. This is a recorded, swappable deviation: once the key has an equity grant, the pull-oracle path (§6.1, §6.3) runs with no code change.

The variables are `OPERATOR_STRIKE_PRICES` and `OPERATOR_CLOSE_PRICES` on `automation` (JSON `{dateKey, source, pricesE6}`; the strike variable also needs `closeDateKey` = the previous trading day).

```bash
# strikes = the previous trading day's official closes; any time from that close until 08:00 ET on the market day
node ops/operator-prices.cjs strike --source "<source, e.g. Nasdaq official close 2026-10-07>"   AAPL=… MSFT=… GOOGL=… AMZN=… NVDA=… META=… TSLA=…
# at/after the 16:00 ET close: official closes for admin_settle
node ops/operator-prices.cjs close --source "<source, e.g. Nasdaq official closing price>"   AAPL=… MSFT=… GOOGL=… AMZN=… NVDA=… META=… TSLA=…
```

- `--date YYYY-MM-DD` names the market day. Without it, a strike set before 08:00 ET is for today, otherwise for the next session. A late `--date <today>` after 08:00 is still accepted until 16:00 ET, with a LATE warning.
- `CREATE_DEADLINE_ET` (default 08:00) is read from the local shell and must match Railway's value.
- The worker reads the variables at start, so the command sets the variable and then redeploys `automation`. `--dry-run` validates only; `--clear strike|close` empties a variable; `--no-restart` skips the redeploy. Needs `RAILWAY_PROJECT_TOKEN` in the environment; no values or tokens are printed.

### 6.3 Settlement

1. **Pull oracle (D-025):** Hermes price at `expiry_ts` → Pyth receiver post (full verification) → permissionless `settle` → close the update accounts. Signed and paid by the settler.
2. **Fallback:** `admin_settle` by the config authority after the on-chain `admin_settle_delay_secs`, at the operator close price bound to the market's day and symbol (source required). The outcome must equal `price ≥ strike` (D-018 Policy A).

Settle-by-16:05 ET on the operator path is not yet guaranteed (DLV-123, open).

### 6.4 Pause at expiry and alerts

- At `expiry_ts` minus `PHOENIX_PAUSE_LEAD_SECS` the pauser sets each book to `Paused` (Phoenix Seat Manager `ChangeMarketStatus`): no new orders or crosses; cancel and withdraw still work. The worker re-checks every book each pass and re-pauses a book that goes Active again.
- Grep Railway and box logs for `[pause] ALERT` and `[settle] ALERT`. There is no external alert sink yet (DLV-111).
- Pauser key rotation and offline backup: [`runbooks/PAUSER_ROTATION.md`](runbooks/PAUSER_ROTATION.md). Mainnet design that replaces the pauser key with a program PDA: [`design/phoenix-pause-pda-authority.md`](design/phoenix-pause-pda-authority.md).

## 7. Pre-deploy checklist

- [ ] `yarn test` green; `yarn build:prod` green (fixture assert included).
- [ ] Deployed binary passes `assert-prod-no-fixtures` (§4).
- [ ] RPC URL and `SOLANA_CLUSTER` match the stage; web cluster is `devnet`, not `custom`.
- [ ] Program id in Railway env matches the on-chain deploy and `declare_id!`.
- [ ] Pyth feed ids are real for the cluster; no mock accounts.
- [ ] Authority, settler and pauser keys are distinct and only in Railway secrets / the box.
- [ ] No `MODE=sim`, no `ANCHOR_FEATURES=localnet-test` on Railway.
- [ ] `GET /api/health` (web) and `GET /health` (automation) return 200.

## 8. CI

[`.gitlab-ci.yml`](../.gitlab-ci.yml) defines `prod-build-no-fixtures` (`yarn build:prod` + fixture assert) and `localnet-anchor-test` (`anchor test -- --features localnet-test`). Labs GitLab has no CI runners for this project; the merge gate is local (and now the Docker toolchain). Note: `.gitlab-ci.yml` still pins Solana 2.1.0, which no longer builds this repo; the Docker toolchain (Agave 4.3.0) is the reference. Results: [`TEST_RESULTS.md`](TEST_RESULTS.md).
