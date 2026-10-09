# Meridian

Meridian is a non-custodial Solana app for binary Yes/No contracts on the daily close of the MAG7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). A Yes token pays $1 USDC if the stock closes at or above the strike at 16:00 ET that day; the No token pays $1 otherwise. Every Yes+No pair is backed by exactly $1 USDC held by the program.

Built for the Peak6 brief: [`docs/PEAK6_PRD.md`](docs/PEAK6_PRD.md).

**Graders: start with [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md)** (every PRD line, its status and evidence).

**Testnet demo (Solana devnet):** https://web-production-77fbb.up.railway.app (connect Phantom on devnet). The program `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` was deployed to devnet on 2026-10-08 and the Railway `web` and `automation` services run from `main`. The first live devnet trading day (create → trade → close → settle → redeem) is Friday 2026-10-09; its results are added to [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) §8 after the close. Mainnet production is future work (see [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md)).

**Settlement on devnet today:** the automated Pyth pull-oracle settle path is built and tested (D-025), but the Hermes key does not yet have equity access (DLV-106). Until it does, staging settles with operator close prices (source logged) and `admin_settle`, whose outcome must match `price ≥ strike`. This is a recorded deviation.

## Architecture in 60 seconds

| Part | What it does |
| --- | --- |
| **Anchor program** (`programs/meridian`, Rust) | Holds USDC in a program vault, mints Yes+No pairs at $1, merges pairs back, settles each market from Pyth, redeems winners 1:1 |
| **Phoenix** (external CLOB) | Matching. One Yes/USDC book per strike; Buy No / Sell No are composed from mint / merge plus a Yes order. Meridian never matches orders |
| **Pyth** (external oracle) | Settlement price: the first verified update at or after the 16:00 ET close (pull oracle, D-025). On devnet, operator close prices stand in until the Hermes key has equity access (DLV-106) |
| **Web app** (`apps/web`, Next.js) | Markets, Trade, Portfolio, History; Phantom / Solflare |
| **Automation** (`apps/automation`, Node) | Creates the day's markets by 08:00 ET, pauses books at the close, settles. It does not create Phoenix books yet (DLV-122) |
| **Ops scripts** (`ops/`) | Devnet bootstrap, Phoenix books, operator prices, settle checks |

Diagrams and trust boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart (local, any time)

```bash
docker compose -f docker/compose.localnet.yml up --build
# wait for [meridian-local] ready, then open http://127.0.0.1:3000 (not localhost)
```

No Rust or Solana install needed: the Docker toolchain image (Rust 1.85, Agave 4.3.0, Anchor 0.31.1, Node 22) builds and runs everything. Details: [`docker/README.md`](docker/README.md). Manual setup, tests and devnet / Railway deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md).

Run the tests:

```bash
# in the Docker toolchain (stop the local instance first: the program suite uses :8899)
docker compose -f docker/compose.localnet.yml run --rm local bash -lc "anchor test -- --features localnet-test"
docker compose -f docker/compose.localnet.yml run --rm local bash -lc "npm test --prefix apps/automation && npm test --prefix apps/web"
```

Or on a host with the same toolchain: `yarn install && yarn test`, `npm test --prefix apps/automation`, `npm run test --prefix apps/web`.

## Deliverables

| PRD deliverable | Where | Status |
| --- | --- | --- |
| Source code | This repository: `programs/`, `apps/`, `ops/`, `scripts/`, `tests/`, `docker/` | Done (`main` @ `4012bbd`) |
| Technical documentation | [`docs/SPEC.md`](docs/SPEC.md) (locked V1 spec) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SCHEMA.md`](docs/SCHEMA.md) with [`accounts`](docs/accounts.md), [`flows`](docs/flows.md), [`units`](docs/units.md), [`sim-clock`](docs/sim-clock.md) · [`docs/ui/`](docs/ui/README.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md) · [`docs/RED_TEAM.md`](docs/RED_TEAM.md) | Done |
| Demo video | Recorded 2026-10-09 (link added at submission). Script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Recorded 2026-10-09 |
| Deployment guide | [`docs/DEPLOY.md`](docs/DEPLOY.md) · [`docker/README.md`](docker/README.md) · runbook [`docs/runbooks/PAUSER_ROTATION.md`](docs/runbooks/PAUSER_ROTATION.md) | Done; devnet deployed 2026-10-08 |
| Test results | [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) · case catalogue [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md) · manual test procedures (working records): [`docs/VISUAL_RUNBOOK.md`](docs/VISUAL_RUNBOOK.md), [`docs/STAGING_TEST_PLAN.md`](docs/STAGING_TEST_PLAN.md) | Done for 2026-10-08 runs; live devnet day added 2026-10-09 |
| AI usage log | [`docs/AI_USAGE.md`](docs/AI_USAGE.md) · full chronological log [`docs/internal/AI_LOG.md`](docs/internal/AI_LOG.md) | Done |

Where every PRD requirement stands, with evidence: [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md).

## Submission checklist

Due Saturday 2026-10-10, 09:00 CT.

- [x] Code merged to `main`: D-026 create by 08:00 ET (!93), Docker toolchain (!94), docs (!95), program id rotation and staging timing (!96), Portfolio SOL tile (!97).
- [x] Program deployed to devnet (2026-10-08, slot 508961032); Railway `web` and `automation` redeployed from `main`.
- [x] Test runs on the current code: Anchor localnet 87 passing / 23 pending / 0 failing, automation 263 passing, web 421 passing, prod build and fixture asserts, deployed binary byte-identical to the build ([`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md)).
- [ ] Friday 2026-10-09: live devnet day (trade → close → settle by 16:05 ET → redeem); fill [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) §8 and [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md) §9.
- [ ] Friday 2026-10-09: record the demo video and add the link above.
- [ ] Friday 2026-10-09: final test refresh on the submission tip (including Rust unit tests and the prod pull-oracle settle, not re-run on 2026-10-08).

## Repository map

| Path | Contents |
| --- | --- |
| `programs/meridian` | Anchor program ([README](programs/meridian/README.md)) |
| `apps/web` | Next.js app ([README](apps/web/README.md)) |
| `apps/automation` | Node worker ([README](apps/automation/README.md)) |
| `ops/` | Operator scripts for devnet staging ([README](ops/README.md)) |
| `scripts/` | Build asserts, IDL emit, localnet market seeding ([localnet README](scripts/localnet/README.md)) |
| `tests/` | Anchor suites ([README](tests/README.md)) |
| `idl/` | Program IDLs (`meridian.prod.json` is the only one clients load off localnet) |
| `docs/` | Deliverable docs (above) |
| `docs/internal/` | Working docs: tracker, raw AI log, agent rules |

Source of truth: Gauntlet Labs GitLab, `debudash/peak6-meridian` (private). Do not publish without Gauntlet Labs approval.
