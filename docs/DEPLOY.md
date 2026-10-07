# Meridian deploy ladder

**Audience:** Meridian Engineers / Debu ops  
**Stack:** Solana program (on-chain) + Next.js web + Node automation on **Railway**  
**Forge:** Gauntlet Labs GitLab only (`labs.gauntletai.com/debudash/peak6-meridian`)

Timestamps and decisions: [`AI_LOG.md`](AI_LOG.md) · locked index: [`DECISIONS.md`](DECISIONS.md)

---

## 1. Environment ladder (required order)

| Stage | Where | Solana cluster | Program build | Oracle | Phoenix | App hosting |
| --- | --- | --- | --- | --- | --- | --- |
| **1. Localnet** | Dev box + GitLab CI | `solana-test-validator` | `yarn build:localnet` / `anchor test -- --features localnet-test` | MockPyth (`upsert_mock_pyth`) | Pubkey wiring only | n/a (tests) |
| **2. Devnet staging** | CLI deploy | Solana **devnet** | **`yarn build:prod` only** | Real Pyth **devnet** feeds | Phoenix **devnet** markets | optional |
| **3. Railway staging** | Railway project (staging) | Points at **devnet** RPC | Uses already-deployed **devnet** program id | Devnet Pyth ids | Devnet Phoenix ids | Next.js + Node automation |
| **4. Railway prod** | Railway project (prod) | **mainnet-beta** | Prod program id from mainnet deploy | Mainnet Pyth | Mainnet Phoenix | Next.js + Node automation |

Never skip: localnet green → prod `.so` fixture assert → devnet program → Railway staging → Railway prod.

---

## 2. Hard rule — `localnet-test` is forbidden off localnet

| Cluster | Allowed build |
| --- | --- |
| Local validator / CI localnet job | `anchor build -- --features localnet-test` / `yarn build:localnet` / `yarn test` |
| **Devnet staging** | **`yarn build:prod`** / `anchor build` (**no features**) |
| **Mainnet** | **`yarn build:prod`** only |

`--features localnet-test` compiles deploy-blocker fixtures into the BPF `.so`:

- `upsert_mock_pyth`
- `test_drain_vault` (can empty vaults)
- `sim_open_session` / `sim_close_session` (and any future `sim_*` / `sim_clock`)

**Authority-only checks are not enough.** CI must fail if fixture strings appear in the production `.so` or `idl/meridian.prod.json` (`scripts/assert-prod-no-fixtures.sh`).

```bash
# Production artifact
yarn build:prod
# → anchor build && emit idl/meridian.prod.json && assert-prod-no-fixtures
```

Clients on devnet/mainnet must load **`idl/meridian.prod.json`**, not the localnet IDL that lists fixtures.

---

## 3. On-chain program deploy (per cluster)

### Prerequisites

- Solana CLI + Anchor matching `Anchor.toml` / CI (`0.31.x`)
- Deployer keypair via **env / secret store only** — never commit keypairs
- Program id: `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (update if redeployed with new key)

### Localnet

```bash
yarn build:localnet
anchor test -- --features localnet-test   # or yarn test
```

### Devnet staging

```bash
yarn build:prod
solana config set --url https://api.devnet.solana.com
# DEPLOYER_KEYPAIR path from secret manager — never commit
solana program deploy target/deploy/meridian.so \
  --program-id target/deploy/meridian-keypair.json \
  --url devnet
```

Then `initialize_config` with **real** Pyth price account pubkeys and Phoenix market pubkeys for devnet. Do **not** call mock/sim/drain ixs (absent from prod `.so`).

### Mainnet

Same as devnet with mainnet URL and mainnet feed/market ids. Require:

1. Reviewer gates closed (real Pyth settle path, fee caps, prod IDL)
2. Devnet soak complete
3. `assert-prod-no-fixtures` green on the exact artifact being deployed

---

## 4. Railway services

Deploy **two** Railway services (staging + prod projects or environments):

| Service | Role | Build | Start |
| --- | --- | --- | --- |
| **web** | Next.js UI | `next build` (app repo / monorepo package) | `next start` |
| **automation** | Node worker (settle retries, sim ops on localnet only, monitoring) | `npm`/`yarn` build of automation package | `node dist/worker.js` (or equivalent) |

The **Solana program is not deployed by Railway** — it is deployed with Solana CLI / governance separately. Railway only talks to an already-deployed program id over RPC.

### Environment variables

Set per Railway environment (staging → devnet, prod → mainnet). **Secrets only via Railway Variables / secret store — never commit.**

| Variable | Staging (devnet) | Prod (mainnet) | Secret? |
| --- | --- | --- | --- |
| `SOLANA_RPC_URL` | Devnet RPC (public or provider) | Mainnet RPC provider | Prefer secret if keyed |
| `SOLANA_CLUSTER` | `devnet` | `mainnet-beta` | no |
| `MERIDIAN_PROGRAM_ID` | Devnet program pubkey | Mainnet program pubkey | no |
| `MERIDIAN_IDL_PATH` | path/URL to **`meridian.prod.json`** | same | no |
| `PYTH_PRICE_FEED_*` / feed map | **Devnet** Pyth price account pubkeys + feed ids | **Mainnet** feeds | no |
| `PHOENIX_MARKET_*` | Devnet Phoenix market pubkeys | Mainnet Phoenix | no |
| `COLLATERAL_MINT` | Devnet USDC (or test mint) | Mainnet USDC | no |
| `AUTHORITY_KEYPAIR` / `AUTOMATION_KEYPAIR` | Base58 or JSON via Railway secret | Railway secret | **YES** |
| `DATABASE_URL` etc. | If app needs DB | | **YES** if credentialed |
| `NEXT_PUBLIC_*` | Public RPC / program id / cluster for browser | | no private keys |

**Never** set `ANCHOR_FEATURES=localnet-test` or deploy a localnet `.so` hash to staging/prod.

### Automation notes

- Staging/prod automation uses **permissionless settle** + **admin_settle** only with authority secret; no mock Pyth upsert.
- Localnet-only sim session / mock Pyth helpers must not be imported into Railway prod bundles (tree-shake / separate package entry).
- Package: [`apps/automation`](../apps/automation) — start `node dist/worker.js` (calendar). Sim one-liner: `yarn automation:sim` (localnet only) — see [`SIM_LIFECYCLE.md`](SIM_LIFECYCLE.md).
- Dual-mode: `MODE=calendar` (default, Railway) vs `MODE=sim` (`sim-lifecycle` entry). Worker refuses `MODE=sim`. Client refuses fixture IDL when `SOLANA_CLUSTER` ≠ `localnet`.

---

## 5. Deploy checklist (Reviewer)

Copy before every non-localnet deploy:

- [ ] `yarn test` / CI `localnet-anchor-test` green (P0/P1/SIM as landed)
- [ ] `yarn build:prod` green
- [ ] `scripts/assert-prod-no-fixtures.sh` green on the artifact to deploy
- [ ] `idl/meridian.prod.json` has **no** `upsert_mock_pyth`, `test_drain_vault`, `sim_*`, `sim_clock`
- [ ] Cluster RPC URL matches intended stage
- [ ] Pyth feed accounts are **real** for that cluster (not mock magic)
- [ ] Phoenix market ids are wiring-only pubkeys for the cluster (no Meridian matcher)
- [ ] Authority / automation keypairs loaded from Railway secrets only
- [ ] Program id in Railway env matches on-chain deploy
- [ ] Pause / fee caps / admin delay understood for the authority key
- [ ] **Confirmed: build did not use `--features localnet-test`**

---

## 6. GitLab CI

File: [`.gitlab-ci.yml`](../.gitlab-ci.yml)

| Job | Purpose |
| --- | --- |
| `prod-build-no-fixtures` | `yarn build:prod` + fixture string assert |
| `localnet-anchor-test` | `anchor test -- --features localnet-test` |

Toolchain (Solana/Anchor/Rust/Node) is cached per branch. If the GitLab instance has **no shared runners**, jobs stay pending until a runner is registered — the YAML still defines the contract.

---

## 7. Related

- Program feature flags: [`programs/meridian/README.md`](../programs/meridian/README.md)
- Schema / flows: [`SCHEMA.md`](SCHEMA.md)
- D-017 sim lifecycle: localnet only (Cluster G)
- Reviewer report (fixtures / Pyth / update_config): internal `meridian-review-main-14d6928.md`
