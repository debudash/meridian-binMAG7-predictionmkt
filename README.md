# Meridian

Meridian is a non-custodial Solana app for binary Yes/No contracts on the daily close of the MAG7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). A Yes token pays $1 USDC if the stock closes at or above the strike at 16:00 ET that day; the No token pays $1 otherwise. Every Yes+No pair is backed by exactly $1 USDC held by the program.

Built for the Peak6 brief: [`docs/PEAK6_PRD.md`](docs/PEAK6_PRD.md).

**Graders: start with [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md)** (every PRD line, its status and evidence).

**Testnet demo (Solana devnet):** https://web-production-77fbb.up.railway.app. It is live once the devnet re-bootstrap lands (DLV-077); connect Phantom on devnet. Mainnet production is future work (see [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md)).

## Architecture in 60 seconds

| Part | What it does |
| --- | --- |
| **Anchor program** (`programs/meridian`, Rust) | Holds USDC in a program vault, mints Yes+No pairs at $1, merges pairs back, settles each market from Pyth, redeems winners 1:1 |
| **Phoenix** (external CLOB) | Matching. One Yes/USDC book per strike; Buy No / Sell No are composed from mint / merge plus a Yes order. Meridian never matches orders |
| **Pyth** (external oracle) | Settlement price: the first verified update at or after the 16:00 ET close (pull oracle, D-025) |
| **Web app** (`apps/web`, Next.js) | Markets, Trade, Portfolio, History; Phantom / Solflare |
| **Automation** (`apps/automation`, Node) | Creates the day's markets, pauses books at the close, settles |
| **Ops scripts** (`ops/`) | Devnet bootstrap, operator prices, settle checks |

Diagrams and trust boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart (local, any time)

```bash
docker compose -f docker/compose.localnet.yml up --build
# open http://localhost:3000
```

Details: [`docker/README.md`](docker/README.md). Manual setup, tests and devnet / Railway deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md).

Run the tests:

```bash
yarn install && yarn test                 # program suite on a local validator
npm test --prefix apps/automation
npm run test --prefix apps/web
```

## Deliverables

| PRD deliverable | Where |
| --- | --- |
| Source code | This repository: `programs/`, `apps/`, `ops/`, `scripts/`, `tests/` |
| Technical documentation | [`docs/SPEC.md`](docs/SPEC.md) (locked V1 spec) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/SCHEMA.md`](docs/SCHEMA.md) with [`accounts`](docs/accounts.md), [`flows`](docs/flows.md), [`units`](docs/units.md), [`sim-clock`](docs/sim-clock.md) · [`docs/ui/`](docs/ui/README.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md) · [`docs/RED_TEAM.md`](docs/RED_TEAM.md) |
| Demo video | Script: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) (video not yet recorded) |
| Deployment guide | [`docs/DEPLOY.md`](docs/DEPLOY.md) · runbook [`docs/runbooks/PAUSER_ROTATION.md`](docs/runbooks/PAUSER_ROTATION.md) |
| Test results | [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) · case catalogue [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md) · manual test procedures (working records): [`docs/VISUAL_RUNBOOK.md`](docs/VISUAL_RUNBOOK.md), [`docs/STAGING_TEST_PLAN.md`](docs/STAGING_TEST_PLAN.md) |
| AI usage log | [`docs/AI_USAGE.md`](docs/AI_USAGE.md) · full chronological log [`docs/internal/AI_LOG.md`](docs/internal/AI_LOG.md) |

Where every PRD requirement stands, with evidence: [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md).

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
