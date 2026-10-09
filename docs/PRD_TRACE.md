# PRD trace

Every line of the Peak6 PRD ([`PEAK6_PRD.md`](PEAK6_PRD.md)) with its status and the evidence in this repo.

**Status key:** **Met** = built and tested · **Partial** = built, with a stated gap · **Scheduled** = set up, runs on the live devnet day 2026-10-09 · **Not yet** = not done.
"Staging" = Railway services pointed at Solana devnet (the PRD's "testnet").

Last reviewed: 2026-10-09 ~08:15 CT (DLV-106 / D-027 update); before that 2026-10-08 ~21:00 CT against `main` @ `4012bbd`. Live devnet evidence is added after the 2026-10-09 close (§9).

## 1. Functional requirements

| PRD line | Status | Evidence |
| --- | --- | --- |
| Daily market creation for 7 stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA) | **Partial** | Worker creates the day's MAG7 markets by 08:00 ET (D-026), expiry 16:00 ET same day (`apps/automation/src/marketDay.ts`, `modes/calendar.ts`; tests `market-day.test.ts`, `same-day-calendar.test.ts`, `d026-create-0800.test.ts`). Localnet: the Docker instance (`docker/localnet/seed.cjs` → `scripts/localnet/today-markets.cjs`) creates all 7 with books. Gaps: the worker does not create Phoenix books (DLV-122). For the 2026-10-09 devnet day, an operator ops job creates the 7 markets after 00:05 ET from the 2026-10-08 official closes, plus Phoenix books for as many markets as the payer SOL covers (5, or 7 if topped up) ([`DEPLOY.md`](DEPLOY.md) §6.1) |
| Yes / No token trading | **Met** | Four intents on one Yes/USDC Phoenix book ([`ARCHITECTURE.md`](ARCHITECTURE.md) §2, D-004, D-018). Program `mint` / `merge_pair`; web `lib/phoenix/compose.ts`. Tests: MP-*, PHX-*, web E2E cases 1–7 ([`TEST_RESULTS.md`](TEST_RESULTS.md)) |
| Automated settlement via oracle | **Met** | Built: Pyth pull oracle (D-025) in the program (`instructions/settle.rs`, `tests/prod/settle_pull_oracle.ts` 22 cases) and in automation (`solana/pullSettle.ts`, `pull-oracle.test.ts`). The Hermes key is entitled to equity feeds since 2026-10-09 (DLV-106). Devnet rehearsal 2026-10-09: a 5-min AAPL ≥ 340 market was settled by `ops-cli pull-settle` (Hermes update → Pyth receiver post → permissionless `settle`), NO at 330.94252 ([`TEST_RESULTS.md`](TEST_RESULTS.md) §8). The Railway worker runs the same pull settle at the 16:00 ET close; the first live close is 2026-10-09, where the first post-close equity update is not yet shown (results in [`TEST_RESULTS.md`](TEST_RESULTS.md) §8). `admin_settle` at an operator close price with a logged source (outcome must equal `price ≥ strike`, Policy A) remains only as the fallback (D-027, [`DEPLOY.md`](DEPLOY.md) §6.2) |
| Position management | **Met** | Portfolio: positions, open orders, Phoenix seat balances, cancel / cancel all / withdraw, redeem (DLV-087, DLV-088). Tests: `lib/portfolio/*.test.ts`, `lib/phoenix/manage*.test.ts`, account E2E 4/4 |
| Real-time order book | **Partial** | Live Phoenix ladder on the trade page, refreshed by polling every 6 s (`lib/rpc/pollPolicy.ts`) and right after your own trades. No websocket streaming |
| Wallet integration | **Met** | Solana wallet adapter: Phantom, Solflare; localnet-only dev wallet behind strict gates (`lib/solana/walletPicker.ts`, `localnetDevWallet.test.ts`, `devServerExposure.test.ts`) |
| Minting / redemption | **Met** | `mint`, `merge_pair`, `redeem`, `burn_losing`. Tests: M-*, MP-*, R-*, V-* |

## 2. Performance benchmarks

| PRD line | Status | Evidence |
| --- | --- | --- |
| Sub-second finality for transactions | **Partial** | Solana property; the app confirms at `confirmed` commitment (`lib/solana/confirm.ts`) and shows success only after confirmation. Not measured in this repo |
| Settlement within 10 minutes of market close | **Partial** | Pull-oracle settle can run as soon as the first Pyth update after 16:00 ET is available. On the operator path, settle waits for the operator close price plus the on-chain `admin_settle` delay, set to 60 s on staging (the program minimum, DLV-123). Not yet shown on a live close: scheduled 2026-10-09 (§9) |
| Real-time order book updates | **Partial** | 6 s polling (see above) |
| Oracle price staleness under 5 minutes | **Met** | On-chain: the price must be the first update at/after expiry and published within 60 s of it (D-025, D-005). PULL-* tests. Strike reference accounts must be fresh (≤ `STRIKE_REF_MAX_AGE_SECS`) |

## 3. Code quality expectations

| PRD line | Status | Evidence |
| --- | --- | --- |
| Unit tests for all core functions | **Met** | Anchor localnet 87 passing / 23 pending / 0 failing (the pending are the prod pull-oracle file, which runs separately: 22 / 22 @ `4012bbd`; Rust unit 6 / 6 @ `4012bbd`), automation 263 passing, web 421 passing; Rust `cargo test` not re-run ([`TEST_RESULTS.md`](TEST_RESULTS.md) §1) |
| Integration tests for full lifecycle | **Met** | Localnet create → mint → trade → settle → redeem: X-04 / X-05, SIM-*, SC-*; real Phoenix E2E 10/10 (opt-in) |
| Frontend tests for UI flows | **Partial** | `apps/web` has 51 vitest files in a Node environment that test UI logic (intent availability, ticket wiring, price display, history, wallet picker, hydration guards) plus 2 opt-in E2E files that drive the web order path against real Phoenix books. There are no component (jsdom) or browser-automation tests in the repo. There are no browser UI-flow tests. UI flows were checked by a headless-browser smoke (not committed) and the manual [`VISUAL_RUNBOOK.md`](VISUAL_RUNBOOK.md) |
| Invariant testing | **Met** | V-*, INV-*, I1–I4 helpers; 25 invariant checks per real-Phoenix E2E run ([`TEST_RESULTS.md`](TEST_RESULTS.md) §4) |
| Clear documentation | **Met** | This docs set; map in the root [`README.md`](../README.md) |
| Reproducible deployment scripts | **Met** | `yarn build:prod` + fixture assert, `railway.json` per service, [`ops/docker-devnet.sh`](../ops/docker-devnet.sh) (deploy, bootstrap, daily markets; the commands used on 2026-10-08), `ops/devnet-bootstrap.cjs` (idempotent, `DRY_RUN=1`), `ops/run-staging.sh`, local Docker compose and the Docker toolchain image. Devnet deploy and bootstrap ran on 2026-10-08 (program, Config, mUSDC, key funding); Railway services redeployed from `main` with `railway up` from a `git archive`. Gaps: the project has no CI runners (the Docker image is the gate; `.gitlab-ci.yml` now pins the same Agave 4.3.0); the 2026-10-09 markets and books come from an ops job, not the worker (DLV-122) |

## 4. Time constraints

| PRD line | Status | Evidence |
| --- | --- | --- |
| Market creation by 8:00 AM ET | **Met in code, verified in tests**; live devnet day **scheduled 2026-10-09** | D-026: create window from 07:00 ET, deadline 08:00 ET with an `ALERT` (retries until 16:00); strikes ATM on the previous session's close (13:00 after an early close), Hermes within `PRIOR_CLOSE_MAX_SKEW_SECS` (300 s) or operator prior closes. `apps/automation/src/modes/calendar.ts`, `marketDay.ts`; test `d026-create-0800.test.ts` ([`DEPLOY.md`](DEPLOY.md) §6.1). On 2026-10-09 the markets are created by the ops job after 00:05 ET, so that day shows markets before the open but not the worker's own create path |
| Trading 9:30 AM – 4:00 PM ET | **Partial** | Close is enforced: mint is refused at/after `expiry_ts` (16:00 ET), the web closes the ticket 5 s early, and books are paused at expiry. There is no 09:30 open gate: books trade from creation (DLV-121, future work) |
| Settlement by 4:05 PM ET | **Partial** | See "Settlement within 10 minutes" above. Staging timing is set (DLV-123); live proof scheduled 2026-10-09 |

## 5. Impact metrics

| PRD line | Status | Evidence |
| --- | --- | --- |
| 100% accuracy in settlements | **Met (tests)** | Outcome = `price ≥ strike` (D-005); immutable once set; `admin_settle` must match the same rule (Policy A, A-05). Above / below / at-strike cases in S-*, E2E cases 8–9. Devnet settlements scheduled 2026-10-09 (§9) |
| Markets created before market open daily | **Met in code, verified in tests**; live devnet day **scheduled 2026-10-09** | See "Market creation by 8:00 AM ET" |
| Settlements within 10 minutes of market close | **Partial** | See §2 |
| Full lifecycle demo on testnet | **Scheduled 2026-10-09** | Program deployed to devnet 2026-10-08 (slot 508961032); Railway `web` and `automation` run from `main` against it; demo URL https://web-production-77fbb.up.railway.app. Trade → close → settle by 16:05 ET → redeem runs on 2026-10-09 (§9). A local Docker instance runs the full lifecycle any time ([`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)) |
| $1.00 payout invariant maintained | **Met** | Vault = pairs × $1 and Yes supply = No supply after every step (V-*, MP-*, E2E); winners redeem exactly $1 |

## 6. Technology

| PRD line | Status | Evidence |
| --- | --- | --- |
| Rust, TypeScript, JavaScript | **Met** | `programs/meridian` (Rust), `apps/*` (TS), `ops/*.cjs` (JS) |
| React, Next.js, Node.js, Anchor, Git | **Met** | `apps/web` (Next.js 14), `apps/automation` (Node), Anchor 0.31.1, GitLab |
| Cloud hosting for the automation service | **Met** | Railway `automation` + `web` services ([`DEPLOY.md`](DEPLOY.md) §5) |
| Solana | **Met** | Anchor program `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj`, deployed to devnet 2026-10-08 |
| Price oracle integration | **Met** in code and tests | Pyth pull oracle (D-025); MAG7 feed ids pinned (D-019, [`SCHEMA.md`](SCHEMA.md) §3.1). On devnet the pull-oracle path settles since the Hermes key gained equity access on 2026-10-09 (DLV-106); operator prices are the fallback |
| USDC integration | **Met** | SPL collateral mint; a test mint ("mUSDC") on devnet |
| Central Limit Order Book | **Met** | Phoenix V1 (integrated, not built: D-002) |
| Environment variables for secrets | **Met** | All keys and tokens via Railway variables / untracked env files ([`DEPLOY.md`](DEPLOY.md) §5.2); CI asserts no fixtures in prod artifacts |

## 7. Required deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Source code | **Met** | This repository |
| Technical documentation | **Met** | [`SPEC.md`](SPEC.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SCHEMA.md`](SCHEMA.md), [`ui/`](ui/README.md), [`DECISIONS.md`](DECISIONS.md), [`RED_TEAM.md`](RED_TEAM.md) |
| Demo video | **Scheduled** | Recorded 2026-10-09 (link added at submission). Script: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (DLV-038) |
| Deployment guide | **Met** | [`DEPLOY.md`](DEPLOY.md) |
| Test results | **Met** (live devnet day and final refresh added 2026-10-09) | [`TEST_RESULTS.md`](TEST_RESULTS.md) |
| AI usage log | **Met** | [`AI_USAGE.md`](AI_USAGE.md) + full log [`internal/AI_LOG.md`](internal/AI_LOG.md) |

## 8. Open items and future work

| Item | Ref |
| --- | --- |
| Live devnet day: trade → close → settle by 16:05 ET → redeem | Scheduled 2026-10-09 (DLV-077, [`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md)) |
| Settle by 16:05 ET on a live close (pull oracle first; operator-price fallback with the 60 s staging delay) | DLV-123 |
| Phoenix books gated to the 09:30–16:00 session (today they trade from creation) | DLV-121 |
| Worker creates the daily Phoenix books (today an ops job does) | DLV-122 |
| Resting Sell No does not merge on fill | DLV-069 |
| History does not show other users' fills | Tracker Todo |
| NYSE early-close days are refused (no market that day) | Tracker Todo |
| Browser UI-flow tests (none today) | §3 |
| The project has no CI runners (`.gitlab-ci.yml` pins Agave 4.3.0 like the Docker image); the Docker toolchain is the gate | [`DEPLOY.md`](DEPLOY.md) §8 |
| Mainnet: PDA pauser authority, M1-closing conditions, external alert sink, deferred reviewer nits, external audit, production market maker | DLV-105, DLV-112, DLV-111, DLV-110 |
| Record the demo video | DLV-038 (2026-10-09) |

## 9. Live devnet day 2026-10-09: results to be filled after the close

Strikes (official Nasdaq closes of 2026-10-08, operator prior closes): AAPL ≥ 340, MSFT ≥ 525, GOOGL ≥ 350, AMZN ≥ 255, NVDA ≥ 230, META ≥ 720, TSLA ≥ 375. Full record: [`TEST_RESULTS.md`](TEST_RESULTS.md) §8.

| Field | Result |
| --- | --- |
| Markets created at (ET) | _to fill_ |
| Books | _to fill_ |
| Trades | _to fill_ |
| Settled at (ET) | _to fill_ |
| Outcome per market | _to fill_ |
| Redeem tx | _to fill_ |

When filled, update the "Scheduled 2026-10-09" rows above.

## 10. Submission checklist

Due Saturday 2026-10-10, 09:00 CT.

| Item | State |
| --- | --- |
| Source code on `main` (!93 D-026, !94 Docker, !95 docs, !96 program id + staging timing, !97 SOL tile) | Done |
| Technical documentation | Done |
| Deployment guide; devnet program deployed and staging bootstrapped | Done (2026-10-08) |
| Test results on the current tip (Anchor, automation, web, prod build, deployed-binary check) | Done (2026-10-08) |
| AI usage log | Done |
| Live devnet day evidence (§9, [`TEST_RESULTS.md`](TEST_RESULTS.md) §8) | Fill on 2026-10-09 after the close |
| Demo video link in [`README.md`](../README.md) and §7 | Fill on 2026-10-09 |
| Final test refresh on the submission tip | Done 2026-10-08 on `4012bbd` (Rust unit and prod settle) and `594d41b` (Anchor); re-check if code changes before submission |
