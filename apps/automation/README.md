# Meridian automation (Node/TS)

Railway-ready dual-mode automation for Peak6 Meridian (**D-017**).

| Mode | Entry | Cluster | IDL |
| --- | --- | --- | --- |
| **calendar** (default) | `node dist/worker.js` | devnet / mainnet-beta | `idl/meridian.prod.json` only |
| **sim** (localnet only) | `node dist/sim-lifecycle.js` | `localnet` | `idl/meridian.json` (full / fixtures) |

## Dual-mode isolation

- `src/worker.ts` imports **only** `modes/calendar.ts` — never `modes/sim.ts`.
- `src/sim-lifecycle.ts` is the sole importer of `modes/sim.ts` (mock Pyth + `sim_open_session` / `sim_close_session`).
- `solana/client.ts` **refuses** fixture IDL instruction names when `SOLANA_CLUSTER` is not `localnet`.
- Never set `ANCHOR_FEATURES=localnet-test` on Railway (`docs/DEPLOY.md` §2).

## Quick start

```bash
cd apps/automation
cp .env.example .env   # fill secrets via env — never commit
npm install
npm run build
npm start              # calendar worker
```

### Sim one-liner (localnet validator + deployed localnet-test program)

```bash
# from repo root
yarn automation:sim
# or
npm run sim-lifecycle --prefix apps/automation
```

Requires `SOLANA_CLUSTER=localnet`, `MODE=sim`, `AUTOMATION_KEYPAIR`, `COLLATERAL_MINT`, and a running local validator with the Meridian program built with `--features localnet-test`.

Lifecycle: **create → sim_open → (mint documented) → sim_close → settle / admin_settle**.

See [`docs/SIM_LIFECYCLE.md`](../../docs/SIM_LIFECYCLE.md).

## Railway

- **Build:** `npm install && npm run build` (in this package, or monorepo equivalent)
- **Start:** `node dist/worker.js`
- Env table: `docs/DEPLOY.md` §4 + `.env.example`
- Program id default: `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6`

## Tests

```bash
npm test
```

Covers ET settle gates, strike encoding, and prod-entry ↔ sim-module isolation.

## Notes / stubs

- Phoenix **market create** is TODO (SDK-heavy); when `PHOENIX_MARKETS` provides a pubkey, automation calls `set_phoenix_market`.
- Strike formula is config-driven: `PRIOR_CLOSE_E6` + `STRIKE_OFFSETS_E6` (extension point for real prior-close).

## Railway

- Service **rootDirectory**: `apps/automation`
- Config: [`railway.json`](./railway.json) — start `node dist/worker.js`, `healthcheckPath=/health`
- IDL: committed/synced [`idl/meridian.prod.json`](./idl/meridian.prod.json) (from `yarn build:prod-idl` at repo root). Default `MERIDIAN_IDL_PATH=idl/meridian.prod.json`.
- Build: `npm run build:railway` (excludes `sim-lifecycle` / `modes/sim` from `dist/`)
- Health: worker listens on `HEALTH_PORT`/`PORT` (default 8080) at `/health`

