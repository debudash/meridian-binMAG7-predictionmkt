# Meridian test results

What is tested, how to run it, and the latest recorded result per suite. Case catalogue: [`TEST_MATRIX.md`](TEST_MATRIX.md). Suite layout: [`tests/README.md`](../tests/README.md).

**Gate:** labs GitLab has no CI runners for this project, so the merge gate is local: every suite runs in the Docker toolchain image (Ubuntu 24.04, Rust 1.85, Agave 4.3.0, Anchor 0.31.1, Node 22, `NODE_OPTIONS=--no-experimental-strip-types`; [`docker/README.md`](../docker/README.md)). Each row gives the latest recorded run and the commit it ran on. Rows marked **not re-run** keep an older result, labelled with its commit.

Current as of 2026-10-08 ~21:00 CT, `main` @ `4012bbd`.

## 1. Summary

| Suite | What it covers | Latest result | Ran on |
| --- | --- | --- | --- |
| Anchor localnet (`anchor test -- --features localnet-test`, `tests/**/*.ts`) | Program: mint, settle, admin_settle, redeem, merge_pair, pause, fees, $1 vault invariants, sim session, SimClock, Phoenix on-book sim, prod IDL gates | **87 passing, 23 pending, 0 failing** (29 min). The 23 pending are the prod pull-oracle file, which skips itself when the prod `.so` is not built (see below) | `594d41b` (!96 branch head; same program code as `main`) |
| Prod pull-oracle settle (`yarn build:prod-so && yarn test:prod-settle`, LiteSVM on the prod `.so`) | D-025 accept / reject rules incl. real devnet and mainnet account bytes | **22 / 22**, re-run 2026-10-08 in the Docker toolchain on the prod `.so` built from main | `4012bbd` |
| Rust unit (`cargo test`) | Pyth parser helpers + program id check | **6 / 6**, re-run 2026-10-08. Needs a host Rust newer than the image's 1.85 for its test-only dependencies (`rustup toolchain install stable`; ran on 1.99) | `4012bbd` |
| Prod build + asserts (`npm run build:prod`, `assert-prod-no-fixtures`, `assert-idl-sync`) | No `sim_*` / `upsert_mock_pyth` / `test_drain_vault` / SimClock in the prod `.so` or IDL; IDL copies in sync | **PASS** | 2026-10-08 Docker run (program code = `main`) |
| Deployed devnet binary | `solana program dump` of `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` | **Byte-identical to the build; fixture assert PASS** | Deployed 2026-10-08, slot 508961032 |
| Automation (`apps/automation`, mocha) | Market-day calendar (DST, holidays, early closes), D-026 create window and deadline, prior-close strikes, operator prices, pull settle, settler / pauser keys, pause monitoring, sim/prod isolation, ops script guards | **263 passing, 13 pending, 0 failing** (pending = opt-in localnet file) | `4012bbd` (automation unchanged since !96) |
| Automation opt-in localnet (`phoenix-pause.localnet.test.ts`, real Phoenix + Seat Manager) | Handoff, pause at expiry, paused book = cancel / withdraw only | **13 / 13** — not re-run; last recorded result | DLV-109 (`7e00a6b`) |
| Web (`apps/web`, vitest) | Intent availability, ticket wiring, Phoenix sizing / compose / errors, price display, history classification, portfolio reads (incl. SOL-for-fees tile), fixture gates, dev-wallet gates, hydration guards | **421 passing, 14 skipped, 0 failing** (skipped = opt-in real-Phoenix E2E). Three `siteMeta` tests need `--testTimeout=60000` on a slow Windows bind mount | `4012bbd` |
| Web opt-in real-Phoenix E2E (`localnet.hardening.e2e.test.ts`) | Four intents, partial fill, slippage / fill-or-kill, opposite-side block, settle above / below strike, pause; 25 invariant checks per run | **10 / 10** — not re-run; last recorded result | 2026-10-07 hardening pass (`1915bb7`) |
| Web opt-in account E2E (`localnet.account.e2e.test.ts`) | Seat balances, cancel / withdraw, sweep, History from chain | **4 / 4** — not re-run; last recorded result | `7f8e766` |
| Typecheck + lint (web) | `tsc`, `next lint` | clean | `4012bbd` |
| Devnet staging lifecycle ([`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md), §8 below) | Phantom, real devnet program and Phoenix books: trade → close → settle → redeem | **Scheduled 2026-10-09** (program deployed and bootstrapped 2026-10-08) | — |

**The 23 pending Anchor tests.** `tests/**/*.ts` includes `tests/prod/settle_pull_oracle.ts`. That file runs against the prod `.so` at `target/prod/meridian.so` (built by `yarn build:prod-so`). When that file is missing, as in an `anchor test` run, its 22 cases are wrapped in `describe.skip` and one placeholder test calls `this.skip()` with the message "prod .so missing … run `yarn build:prod-so`". 22 + 1 = 23 pending. No program test is disabled: the 87 passing are every other case (§3), and the 22 pull-oracle cases run in their own command (row 2). The old build box ran both together as 109 / 109 on `dd46769`; that run is history.

**Ledger timeouts.** An earlier Anchor run in Docker with the test ledger on the Windows bind mount timed out 7 tests. With the ledger on a Linux volume the same suite passed 87 / 0. `Anchor.toml` `[test] startup_wait = 120000` covers slow ledger start-up.

## 2. How to run

All commands below also run inside the Docker toolchain image (Rust 1.85, Agave 4.3.0, Anchor 0.31.1, Node 22), which is the reference toolchain: prefix them with `docker compose -f docker/compose.localnet.yml run --rm local bash -lc "…"` ([`docker/README.md`](../docker/README.md)).

```bash
yarn install

# Program suite (builds with localnet-test, starts its own validator; ~30 min)
yarn test                      # = anchor test -- --features localnet-test

# Prod build + fixture assert
yarn build:prod

# Prod pull-oracle settle on the prod .so (LiteSVM)
yarn build:prod-so && yarn test:prod-settle

# Rust unit tests
cargo +stable test --manifest-path programs/meridian/Cargo.toml --lib   # host Rust > 1.85 for test deps

# Automation
npm test --prefix apps/automation
# opt-in: needs a validator with Phoenix V1 + Seat Manager loaded
PHOENIX_LOCALNET_RPC=http://127.0.0.1:8699 npm test --prefix apps/automation

# Web
npm run test --prefix apps/web
npm run typecheck --prefix apps/web && npm run lint --prefix apps/web && npm run build --prefix apps/web
# opt-in: needs a spare validator seeded with Phoenix books (scripts/e2e/create-lifecycle-markets.ts)
cd apps/web && LOCALNET_E2E=1 npx vitest run src/lib/phoenix/localnet.hardening.e2e.test.ts
cd apps/web && LOCALNET_E2E=1 npx vitest run src/lib/portfolio/localnet.account.e2e.test.ts
```

**PHX on-book sim (Anchor harness).** `tests/phoenix_onbook_e2e.ts` (PHX-01…06) drives the four intents through `simTradeOnBook` (`tests/helpers/phoenix_onbook.ts`): compose, optional `mint`, a simulated Yes↔USDC book fill at the planned price, optional `merge_pair`. It never touches the vault outside Meridian instructions. Run only these with `yarn test:phoenix-onbook` (still needs the Anchor validator lifecycle) or the compose unit cases with `yarn test:phoenix-compose`. `PHOENIX_ONBOOK_MODE` selects the path: `book-sim` (default), `off-book-fallback` (refuses `simTradeOnBook`; call `simTradeOffBook`, the demoted V-08 twin, explicitly), or `phoenix` (reserved: throws, because creating a real Phoenix market is not wired into the Anchor harness; real books are covered by the web opt-in E2E).

The program keypair is not in git. Restore or generate `keys/meridian-keypair.json` whose pubkey matches `declare_id!` ([`keys/README.md`](../keys/README.md)).

## 3. Anchor suite breakdown (87 passing on `594d41b`, plus 22 PULL run separately)

| Prefix | File | Cases | Covers |
| --- | --- | ---: | --- |
| M | `mint.ts`, `p1_edges.ts`, `fees.ts` | 11 | Mint happy path, pause, not open, after expiry, insufficient funds, zero amount, missing ATA, multi-user, fee-on-mint |
| S | `settle.ts`, `p1_edges.ts`, `unit/pyth_price_to_e6.ts` | 14 | Staleness, confidence, wrong account, immutable outcome, `≥` strike, price conversion vectors |
| A | `settle.ts`, `p2_gates.ts` | 5 | `admin_settle` delay, authority, no override, Policy A |
| R | `redeem.ts`, `fees.ts`, `p2_gates.ts` | 9 | Winner-only, partial / full, open-market reject, redeem fee, `burn_losing` |
| V | `invariants.ts`, `p1_edges.ts`, `fees.ts` | 8 | I1–I3: vault = pairs × $1, Yes supply = No supply |
| X | `pause.ts`, `p1_edges.ts`, `p2_gates.ts` | 7 | Pause blocks mint / create; settle and redeem still work; full lifecycle I4 |
| MP | `merge_pair.ts` | 8 | `merge_pair` while open, after expiry, pause / settled reject, fees, invariants |
| SIM | `sim_session.ts` | 9 | D-017 anytime open → trade → close → settle → redeem |
| SC | `sim_clock.ts` | 4 | SimClock warp → settle, mint after expiry, admin delay without wall-clock waits; prod IDL strip |
| PHX + U | `phoenix_onbook_e2e.ts`, `unit/phoenix_compose.ts` | 9 | Four intents composed against a simulated book fill; real mint / merge |
| INV | `p2_gates.ts` | 3 | Prod IDL has no fixtures, fee truncation, burn preserves I3 |
| PULL | `prod/settle_pull_oracle.ts` | 22 | D-025 rules on the prod `.so`, including a non-authority settler. Pending in `anchor test`; run with `yarn test:prod-settle` (last 22 / 22 @ `ab3b57c`) |

PHX cases use a simulated book fill inside the Anchor harness. Trading against real Phoenix V1 books on a local validator is covered by the web opt-in E2E (§1) and by `scripts/localnet/today-markets.cjs`, which creates real books.

## 4. Invariants proven

| Invariant | Where |
| --- | --- |
| Vault USDC = outstanding pairs × $1 (fee = 0) | V-01…V-05, X-04 / X-05, MP-*, real-Phoenix E2E after every step |
| Yes supply = No supply until settle | Same as above |
| Winner redeems exactly $1 per token; loser gets 0 | R-*, E2E cases 8 and 9 |
| Outcome is immutable once settled; `admin_settle` cannot override | S-*, A-* |
| `admin_settle` outcome must equal `price ≥ strike` | A-05 |
| Pause blocks mint and create, never settle or redeem | X-01…X-06 |
| Stale or wide-confidence prices are rejected; prod accepts only the first Full-verified update at / after expiry | S-*, PULL-* |
| No test-only instruction in the prod artifact | INV-PROD-01, `assert-prod-no-fixtures.sh` |
| A market order either fills fully or reverts (no stray Yes+No after Buy No) | E2E case 7 (D-024) |

## 5. Manual and exploratory checks

- **UI smoke (2026-10-07):** headless Chrome over 18 routes × desktop / mobile; all 200, no horizontal overflow, 386 controls clicked, 0 failures. The smoke script is not committed.
- **Visual runbook:** click-by-click manual pass on localnet ([`VISUAL_RUNBOOK.md`](VISUAL_RUNBOOK.md)).
- **Security checks (2026-10-07):** no keys, tokens or fixture instructions in the client bundle; the dev wallet cannot run in a production build or on a non-loopback server.

## 6. Bugs found by tests and fixed

| Found by | Bug | Fix |
| --- | --- | --- |
| Real-Phoenix localnet run | Phoenix order size sent in atoms, not whole tokens (10⁶× too big) | D-020 |
| Hardening E2E | Buy No could mint and under-fill, leaving Yes+No | Fill-or-kill market orders (D-024) |
| Hardening smoke | Hydration errors on the trade page and countdowns | DLV-079, DLV-086 |
| Hardening security check | A prod build with localnet env served the dev-wallet key | DLV-080, DLV-081 |
| Suite flake analysis | Timing races in X-03 / SIM-08 | Harness slack + clock-sysvar polling (harness only) |

## 7. Known gaps

- **No browser UI-flow tests.** The vitest suites test UI logic in a Node environment; there are no component (jsdom) or browser-automation tests. UI flows were checked by the manual runbook and an uncommitted headless smoke (§5). PRD "frontend tests for UI flows" is Partial ([`PRD_TRACE.md`](PRD_TRACE.md)).
- **Devnet lifecycle** not yet run: scheduled for 2026-10-09 (§8).
- **Pyth pull settle on devnet** with a real Hermes equity price ran once, on a 5-min rehearsal market (§8); the worker's first pull settle at a 16:00 ET close is 2026-10-09.
- History does not show fills by other traders; a resting Sell No does not merge on fill (DLV-069).
- Not re-run in this pass: the opt-in localnet E2E suites (§1). Rust unit (6 / 6) and prod pull-oracle settle (22 / 22) were re-run on `4012bbd`.

## 8. Live devnet day 2026-10-09: results to be filled after the close

Program `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` on devnet; app https://web-production-77fbb.up.railway.app. Markets for Friday 2026-10-09 are created by an operator ops job after 00:05 ET, with strikes from the official Nasdaq closes of 2026-10-08 (operator prior closes, D-026): AAPL ≥ 340, MSFT ≥ 525, GOOGL ≥ 350, AMZN ≥ 255, NVDA ≥ 230, META ≥ 720, TSLA ≥ 375. These strikes stay (the strike is a PDA seed, fixed at creation). Settlement at the 16:00 ET close is by the Railway worker's Pyth pull-oracle path; operator close prices with a logged source plus `admin_settle` (60 s delay, Policy A) are the fallback (D-027).

Pull-oracle rehearsal (2026-10-09 ~09:10 ET, DLV-106): the Hermes key returned HTTP 200 with fresh prices for all 7 MAG7 feed ids (previously 403 "not entitled"). A 5-min AAPL ≥ 340 market `H7emK9LFiETTpVTvJGZGg5SAhw9YFFuNABHwY8AxmVeX` (no book) was settled by `ops-cli pull-settle` (Hermes update → Pyth Solana receiver post → permissionless `settle`, signed by the settler key): `PULL_SETTLE_OK via=posted` on the first attempt, settled **NO** at resolved price 330.94252, settled slot 509189340. Txs `AAN59hbUGPRQqwFxMULp7singZuweQWGCqvdAdhaPu6XbjFJ5j7vESKbTMMQd8kzaNMaPFc7ecJbKKF79mTPfAK`, `5xA2w93upzVmJioCUS8nuhk5WH5cQfm6HA6oRTw84ccwJwD8jFM9LBmuGHPgevRpbTaGuYLRPkZQAbXErBteav6W`.

| Field | Result |
| --- | --- |
| Markets created at (ET) | _to fill_ |
| Phoenix books (count, symbols) | _to fill_ (5 planned, 7 if the payer is topped up; 1.18 SOL rent per book) |
| Trades (wallets, intents, tx) | _to fill_ |
| Books paused at (ET) | _to fill_ |
| Close prices used (source) | _to fill_ |
| Settled at (ET), per market | _to fill_ (target: by 16:05 ET) |
| Outcome per market (close vs strike → Yes / No) | _to fill_ |
| Redeem tx | _to fill_ |
| Invariants checked after redeem | _to fill_ |
| Issues seen | _to fill_ |
