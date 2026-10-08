# PRD trace

Every line of the Peak6 PRD ([`PEAK6_PRD.md`](PEAK6_PRD.md)) with its status and the evidence in this repo.

**Status key:** **Met** = built and tested · **Partial** = built, with a stated gap · **Not yet** = not done.
"Staging" = Railway services pointed at Solana devnet (the PRD's "testnet").

Last reviewed: 2026-10-08 against `main` @ `a5146d4`.

## 1. Functional requirements

| PRD line | Status | Evidence |
| --- | --- | --- |
| Daily market creation for 7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA) | **Partial** | Worker creates the day's MAG7 markets, expiry 16:00 ET same day (`apps/automation/src/marketDay.ts`, `modes/calendar.ts`; tests `market-day.test.ts`, `same-day-calendar.test.ts`). Localnet: `scripts/localnet/today-markets.cjs` creates all 7 with books. Gaps: worker-created markets have no Phoenix book yet; staging `STRIKE_SYMBOLS` is `AAPL` only and the keeper needs devnet SOL ([`DEPLOY.md`](DEPLOY.md) §6.1) |
| Yes / No token trading | **Met** | Four intents on one Yes/USDC Phoenix book ([`ARCHITECTURE.md`](ARCHITECTURE.md) §2, D-004, D-018). Program `mint` / `merge_pair`; web `lib/phoenix/compose.ts`. Tests: MP-*, PHX-*, web E2E cases 1–7 ([`TEST_RESULTS.md`](TEST_RESULTS.md)) |
| Automated settlement via oracle | **Partial** | Built: Pyth pull oracle (D-025) in the program (`instructions/settle.rs`, `tests/prod/settle_pull_oracle.ts` 22 cases) and in automation (`solana/pullSettle.ts`, `pull-oracle.test.ts`). Deviation: the devnet Hermes key lacks the equity entitlement (DLV-106), so staging settles by `admin_settle` at an operator-sourced close price with a logged source. Recorded and swappable: no code change when the key is entitled ([`DEPLOY.md`](DEPLOY.md) §6.2) |
| Position management | **Met** | Portfolio: positions, open orders, Phoenix seat balances, cancel / cancel all / withdraw, redeem (DLV-087, DLV-088). Tests: `lib/portfolio/*.test.ts`, `lib/phoenix/manage*.test.ts`, account E2E 4/4 |
| Real-time order book | **Partial** | Live Phoenix ladder on the trade page, refreshed by polling every 6 s (`lib/rpc/pollPolicy.ts`) and right after your own trades. No websocket streaming |
| Wallet integration | **Met** | Solana wallet adapter: Phantom, Solflare; localnet-only dev wallet behind strict gates (`lib/solana/walletPicker.ts`, `localnetDevWallet.test.ts`, `devServerExposure.test.ts`) |
| Minting / redemption | **Met** | `mint`, `merge_pair`, `redeem`, `burn_losing`. Tests: M-*, MP-*, R-*, V-* |

## 2. Performance benchmarks

| PRD line | Status | Evidence |
| --- | --- | --- |
| Sub-second finality for transactions | **Partial** | Solana property; the app confirms at `confirmed` commitment (`lib/solana/confirm.ts`) and shows success only after confirmation. Not measured in this repo |
| Settlement within 10 minutes of market close | **Partial** | Pull-oracle settle can run as soon as the first Pyth update after 16:00 ET is available. On the operator path, settle waits for the operator close price plus the on-chain `admin_settle` delay (300 s on staging); a 16:05 ET guarantee is open (DLV-123) |
| Real-time order book updates | **Partial** | 6 s polling (see above) |
| Oracle price staleness under 5 minutes | **Met** | On-chain: the price must be the first update at/after expiry and published within 60 s of it (D-025, D-005). PULL-* tests. Strike reference accounts must be fresh (≤ `STRIKE_REF_MAX_AGE_SECS`) |

## 3. Code quality expectations

| PRD line | Status | Evidence |
| --- | --- | --- |
| Unit tests for all core functions | **Met** | Anchor suite 109, Rust `cargo test`, automation 228, web 418 ([`TEST_RESULTS.md`](TEST_RESULTS.md) §1) |
| Integration tests for full lifecycle | **Met** | Localnet create → mint → trade → settle → redeem: X-04 / X-05, SIM-*, SC-*; real Phoenix E2E 10/10 (opt-in) |
| Frontend tests for UI flows | **Partial** | `apps/web` has 51 vitest files in a Node environment that test UI logic (intent availability, ticket wiring, price display, history, wallet picker, hydration guards) plus 2 opt-in E2E files that drive the web order path against real Phoenix books. There are no component (jsdom) or browser-automation tests in the repo. UI flows were checked by a headless-browser smoke (not committed) and the manual [`VISUAL_RUNBOOK.md`](VISUAL_RUNBOOK.md) |
| Invariant testing | **Met** | V-*, INV-*, I1–I4 helpers; 25 invariant checks per real-Phoenix E2E run ([`TEST_RESULTS.md`](TEST_RESULTS.md) §4) |
| Clear documentation | **Met** | This docs set; map in the root [`README.md`](../README.md) |
| Reproducible deployment scripts | **Partial** | `yarn build:prod` + fixture assert, `railway.json` per service, `ops/run-staging.sh` + `ops/devnet-bootstrap.cjs` (idempotent, `DRY_RUN=1`), local Docker compose. The full devnet bootstrap has not been run end to end yet (devnet SOL, DLV-077) |

## 4. Time constraints

| PRD line | Status | Evidence |
| --- | --- | --- |
| Market creation by 8:00 AM ET | **Partial** | On `main` the worker creates at the 9:30 ET open. D-026 (branch in flight) moves creation to 08:00 ET using the prior close |
| Trading 9:30 AM – 4:00 PM ET | **Partial** | Close is enforced: mint is refused at/after `expiry_ts` (16:00 ET), the web closes the ticket 5 s early, and books are paused at expiry. The program has no 9:30 open gate; on `main` trading starts when the market is created |
| Settlement by 4:05 PM ET | **Partial** | See "Settlement within 10 minutes" above (DLV-123 open) |

## 5. Impact metrics

| PRD line | Status | Evidence |
| --- | --- | --- |
| 100% accuracy in settlements | **Met (tests)** | Outcome = `price ≥ strike` (D-005); immutable once set; `admin_settle` must match the same rule (Policy A, A-05). Above / below / at-strike cases in S-*, E2E cases 8–9. Not yet observed on devnet |
| Markets created before market open daily | **Partial** | See "Market creation by 8:00 AM ET" |
| Settlements within 10 minutes of market close | **Partial** | See §2 |
| Full lifecycle demo on testnet | **Not yet** | Railway staging services are up; the program and markets are not yet on devnet (DLV-077). A local Docker instance runs the full lifecycle any time ([`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)) |
| $1.00 payout invariant maintained | **Met** | Vault = pairs × $1 and Yes supply = No supply after every step (V-*, MP-*, E2E); winners redeem exactly $1 |

## 6. Technology

| PRD line | Status | Evidence |
| --- | --- | --- |
| Rust, TypeScript, JavaScript | **Met** | `programs/meridian` (Rust), `apps/*` (TS), `ops/*.cjs` (JS) |
| React, Next.js, Node.js, Anchor, Git | **Met** | `apps/web` (Next.js 14), `apps/automation` (Node), Anchor 0.31.1, GitLab |
| Cloud hosting for the automation service | **Met** | Railway `automation` + `web` services ([`DEPLOY.md`](DEPLOY.md) §5) |
| Solana | **Met** | Anchor program; devnet deploy pending (DLV-077) |
| Price oracle integration | **Met** | Pyth pull oracle (D-025); MAG7 feed ids pinned (D-019, [`SCHEMA.md`](SCHEMA.md) §3.1) |
| USDC integration | **Met** | SPL collateral mint; a test mint ("mUSDC") on devnet |
| Central Limit Order Book | **Met** | Phoenix V1 (integrated, not built: D-002) |
| Environment variables for secrets | **Met** | All keys and tokens via Railway variables / untracked env files ([`DEPLOY.md`](DEPLOY.md) §5.2); CI asserts no fixtures in prod artifacts |

## 7. Required deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Source code | **Met** | This repository |
| Technical documentation | **Met** | [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SCHEMA.md`](SCHEMA.md), [`ui/`](ui/README.md), [`DECISIONS.md`](DECISIONS.md), [`RED_TEAM.md`](RED_TEAM.md) |
| Demo video | **Not yet** | Script ready: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (DLV-038) |
| Deployment guide | **Met** | [`DEPLOY.md`](DEPLOY.md) |
| Test results | **Met** (counts to refresh on the final tip) | [`TEST_RESULTS.md`](TEST_RESULTS.md) |
| AI usage log | **Met** | [`AI_USAGE.md`](AI_USAGE.md) + full log [`internal/AI_LOG.md`](internal/AI_LOG.md) |

## 8. Open items that affect the PRD

| Item | Ref |
| --- | --- |
| Deploy the program and bootstrap markets on devnet; run the staging plan | DLV-077, [`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md) |
| Hermes key with equity entitlement (removes the operator-price deviation) | DLV-106 |
| Create by 08:00 ET on the prior close | D-026 (in flight) |
| Settle by 16:05 ET on the operator path | DLV-123 |
| Phoenix book per worker-created daily market | Tracker Todo |
| Record the demo video | DLV-038 |
