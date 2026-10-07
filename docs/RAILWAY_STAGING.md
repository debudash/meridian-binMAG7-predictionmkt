# Railway staging checklist (Meridian)

**Do not** create the Railway project from agents — Debu connects the project. This doc is env + rootDirectory only.

Program id (devnet): `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6`  
Specs: [`DEPLOY.md`](DEPLOY.md) §4 · healthchecks already in package `railway.json`.

## 1. Connect project

1. Create / open a Railway **staging** project (human).
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

- Creating the Railway project
- Deploying the Solana program
- Committing secrets
