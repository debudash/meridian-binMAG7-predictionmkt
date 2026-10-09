# Meridian test results

What is tested, how to run it, and the latest recorded result per suite. Case catalogue: [`TEST_MATRIX.md`](TEST_MATRIX.md). Suite layout: [`tests/README.md`](../tests/README.md).

**Gate:** labs GitLab has no CI runners for this project, so the merge gate is local: every suite runs in the Docker toolchain image (Ubuntu 24.04, Rust 1.85, Agave 4.3.0, Anchor 0.31.1, Node 22, `NODE_OPTIONS=--no-experimental-strip-types`; [`docker/README.md`](../docker/README.md)). Each row gives the latest recorded run and the commit it ran on. Rows marked **not re-run** keep an older result, labelled with its commit.

Suite rows current as of 2026-10-08 ~21:00 CT, `main` @ `4012bbd`, unless a row says otherwise. Added 2026-10-09: the live devnet day (§8), the operator copilot tests and the live `/status` check on `main` @ `c9f6699` (after !101 palette D-028, !102 copilot D-029, !103 copilot in the worker D-030).

## 1. Summary

| Suite | What it covers | Latest result | Ran on |
| --- | --- | --- | --- |
| Anchor localnet (`anchor test -- --features localnet-test`, `tests/**/*.ts`) | Program: mint, settle, admin_settle, redeem, merge_pair, pause, fees, $1 vault invariants, sim session, SimClock, Phoenix on-book sim, prod IDL gates | **87 passing, 23 pending, 0 failing** (29 min). The 23 pending are the prod pull-oracle file, which skips itself when the prod `.so` is not built (see below) | `594d41b` (!96 branch head; same program code as `main`) |
| Prod pull-oracle settle (`yarn build:prod-so && yarn test:prod-settle`, LiteSVM on the prod `.so`) | D-025 accept / reject rules incl. real devnet and mainnet account bytes | **22 / 22**, re-run 2026-10-08 in the Docker toolchain on the prod `.so` built from main | `4012bbd` |
| Rust unit (`cargo test`) | Pyth parser helpers + program id check | **6 / 6**, re-run 2026-10-08. Needs a host Rust newer than the image's 1.85 for its test-only dependencies (`rustup toolchain install stable`; ran on 1.99) | `4012bbd` |
| Prod build + asserts (`npm run build:prod`, `assert-prod-no-fixtures`, `assert-idl-sync`) | No `sim_*` / `upsert_mock_pyth` / `test_drain_vault` / SimClock in the prod `.so` or IDL; IDL copies in sync | **PASS** | 2026-10-08 Docker run (program code = `main`) |
| Deployed devnet binary | `solana program dump` of `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` | **Byte-identical to the build; fixture assert PASS** | Deployed 2026-10-08, slot 508961032 |
| Automation (`apps/automation`, mocha) | Market-day calendar (DST, holidays, early closes), D-026 create window and deadline, prior-close strikes, operator prices, pull settle, settler / pauser keys, pause monitoring, sim/prod isolation, ops script guards | **263 passing, 13 pending, 0 failing** (pending = opt-in localnet file) | `4012bbd` (full automation suite not re-run after !102 / !103; copilot 18 / 18 on `c9f6699`, row below) |
| Automation copilot (`test/copilot.test.ts`) | D-029 / D-030 operator copilot: create / settle checkpoint facts, code-written message, `verifyHeadline` guard (Claude stubbed), 08:30 / 16:30 ET timing, weekend and restart cases, single failure report; the real 2026-10-09 day as fixture | **18 / 18** | `c9f6699` |
| Automation opt-in localnet (`phoenix-pause.localnet.test.ts`, real Phoenix + Seat Manager) | Handoff, pause at expiry, paused book = cancel / withdraw only | **13 / 13** — not re-run; last recorded result | DLV-109 (`7e00a6b`) |
| Web (`apps/web`, vitest) | Intent availability, ticket wiring, Phoenix sizing / compose / errors, price display, history classification, portfolio reads (incl. SOL-for-fees tile), fixture gates, dev-wallet gates, hydration guards | **421 passing, 14 skipped, 0 failing** (skipped = opt-in real-Phoenix E2E). Three `siteMeta` tests need `--testTimeout=60000` on a slow Windows bind mount. On `c9f6699` (palette, `/status` page, `copilotStatus.test.ts`): **423 / 424**, the one failure being the pre-existing `siteMeta` 404 timeout (§7) | `4012bbd`; `c9f6699` |
| Web opt-in real-Phoenix E2E (`localnet.hardening.e2e.test.ts`) | Four intents, partial fill, slippage / fill-or-kill, opposite-side block, settle above / below strike, pause; 25 invariant checks per run | **10 / 10** — not re-run; last recorded result | 2026-10-07 hardening pass (`1915bb7`) |
| Web opt-in account E2E (`localnet.account.e2e.test.ts`) | Seat balances, cancel / withdraw, sweep, History from chain | **4 / 4** — not re-run; last recorded result | `7f8e766` |
| Typecheck + lint (web) | `tsc`, `next lint` | clean | `4012bbd` |
| Devnet staging lifecycle ([`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md), §8 below) | Phantom, real devnet program and Phoenix books: trade → close → settle → redeem | **Ran 2026-10-09:** 7 markets with 7 books, 4 trades, 7 books paused at expiry, **7 / 7 settled by the Pyth pull oracle** (no `admin_settle`, no ALERT). Devnet redeem not yet recorded | Program `3X3E…K91Hj`, Railway worker |
| Operator copilot live (`/status`) | Worker `GET /copilot` → web `/status` over Railway private networking | **OK 2026-10-09:** after the ~19:05 ET deploy the worker logged create ✅ 7/7 and settle ✅ 7/7 for 2026-10-09 and https://web-production-77fbb.up.railway.app/status shows both reports (`Written by code`) | automation `1d2a0427`, web `41cd409b` (both from `c9f6699`) |

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
- **Devnet redeem** after the 2026-10-09 settle is not yet recorded here (§8).
- **Pre-existing test issues (not caused by the 2026-10-09 changes):** web `siteMeta` 404 test times out (423 / 424 on `c9f6699`; passes with `--testTimeout=60000`, §1); automation `test/ops-staging-nits.test.ts` fails to load on `main` (ESM `__dirname`) in the 2026-10-09 run outside the Docker gate, also before the copilot MRs; it was part of the 0-failing Docker run at `4012bbd`.
- History does not show fills by other traders; a resting Sell No does not merge on fill (DLV-069).
- Not re-run in this pass: the opt-in localnet E2E suites (§1). Rust unit (6 / 6) and prod pull-oracle settle (22 / 22) were re-run on `4012bbd`.

## 8. Live devnet day 2026-10-09

Program `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj` on devnet; app https://web-production-77fbb.up.railway.app. Markets for Friday 2026-10-09 were created by an operator ops job after 00:05 ET, with strikes from the official Nasdaq closes of 2026-10-08 (operator prior closes, D-026): AAPL ≥ 340, MSFT ≥ 525, GOOGL ≥ 350, AMZN ≥ 255, NVDA ≥ 230, META ≥ 720, TSLA ≥ 375. These strikes stay (the strike is a PDA seed, fixed at creation). Settlement at the 16:00 ET close was by the Railway worker's Pyth pull-oracle path; operator close prices with a logged source plus `admin_settle` (60 s delay, Policy A) were the unused fallback (D-027).

Pull-oracle rehearsal (2026-10-09 ~09:10 ET, DLV-106): the Hermes key returned HTTP 200 with fresh prices for all 7 MAG7 feed ids (previously 403 "not entitled"). A 5-min AAPL ≥ 340 market `H7emK9LFiETTpVTvJGZGg5SAhw9YFFuNABHwY8AxmVeX` (no book) was settled by `ops-cli pull-settle` (Hermes update → Pyth Solana receiver post → permissionless `settle`, signed by the settler key): `PULL_SETTLE_OK via=posted` on the first attempt, settled **NO** at resolved price 330.94252, settled slot 509189340. Txs `AAN59hbUGPRQqwFxMULp7singZuweQWGCqvdAdhaPu6XbjFJ5j7vESKbTMMQd8kzaNMaPFc7ecJbKKF79mTPfAK`, `5xA2w93upzVmJioCUS8nuhk5WH5cQfm6HA6oRTw84ccwJwD8jFM9LBmuGHPgevRpbTaGuYLRPkZQAbXErBteav6W`.

| Field | Result |
| --- | --- |
| Markets and books | Ops bootstrap (phase B, in Docker) at **00:05 ET** created AAPL, MSFT and GOOGL in full (market, Phoenix book, seat-manager handoff to the pauser, maker ladder), then aborted on AMZN's seat-manager handoff (first attempt "fetch failed" but landed; the retry failed "Incorrect key for signer"). Books were capped at 5 (`NBOOKS`) by the payer's SOL. Debu sent +10 devnet SOL to the payer `Fm34E3…9XVo`; a **09:00 ET** rerun of `devnet-bootstrap.cjs` with `NBOOKS=7` on the same `today-plan.json` was idempotent (same-PDA markets are not duplicated; the handoff is skipped when the pauser already holds the authority): it finished AMZN and created the NVDA, META and TSLA books + maker ladders. After the rerun **all 7 markets were open with 49 / 51 books**. Payer left with 8.07 SOL |
| Trades | Debu, Phantom wallet `G5dtmt73NNcDramXQUr6ckfNP9umAWwjpRwsMh7jUTLY`, 10:46–10:48 ET (09:46–09:48 CT), 20 contracts each at 0.51 = 10.20 mUSDC each: **Buy No AAPL**, **Buy Yes NVDA**, **Buy Yes TSLA**, **Buy No MSFT** (a deliberate losing side). Spent 40.80 mUSDC |
| Books paused | All 7 Phoenix books paused at expiry (16:00 ET) by the Railway worker |
| Close prices used (source) | Pyth pull oracle (D-025), permissionless `settle`: a Hermes update at the close posted through the Pyth receiver (worker log `settled (pull oracle, posted)`: AMZN, GOOGL, META, NVDA, TSLA) or the sponsored `PriceUpdateV2` already holding the close (`settled (pull oracle, sponsored)`: AAPL, MSFT). No operator close prices, no `admin_settle` |
| Settled at | All 7 by the worker after the 16:00 ET close, no `[settle] ALERT`. AAPL settle tx `2rdWCJqyACv513dnYhAGiyBnXtcs7SaEsThqhuejqt2xVMDYc2tfRCDGkVtPiNaNqG6U9ZqinDjdaXzNtHua2mae` at **16:00:25 ET** (15:00:25 CT), slot 509292416, confidence ± $0.08 (market page settlement proof) |
| Outcome per market (Pyth close vs strike) | AAPL 336.51 < 340 **NO** · AMZN 262.43 ≥ 255 **YES** · GOOGL 351.60 ≥ 350 **YES** · META 718.38 < 720 **NO** · MSFT 535.08 ≥ 525 **YES** · NVDA 229.34 < 230 **NO** · TSLA 382.75 ≥ 375 **YES** (4 YES, 3 NO; each matches `price ≥ strike`) |
| Debu's results | AAPL No won · NVDA Yes lost (229.34 vs 230) · TSLA Yes won · MSFT No lost. Winning tokens (40) redeem for 40.00 mUSDC against 40.80 spent |
| Settlement proof | Each market page shows **View settlement proof** (price, confidence, slot, settle tx). An ad-hoc operator checker outside the repo printed 7 / 7 settled |
| Copilot cross-check | The worker's operator copilot (D-030, deployed ~19:05 ET) logged create ✅ 7/7 (7 with an order book) and settle ✅ 7/7 (4 YES, 3 NO) for 2026-10-09, shown on `/status` |
| Redeem tx | Not yet recorded |
| Invariants checked after redeem | Not yet recorded |
| Issues seen | AMZN seat-manager handoff failure and the 5-book SOL cap at 00:05 ET, both cleared by the idempotent 09:00 ET rerun. Lesson: the bootstrap is safe to rerun after a partial failure |
