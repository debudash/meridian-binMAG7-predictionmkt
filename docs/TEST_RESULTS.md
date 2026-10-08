# Meridian test results

What is tested, how to run it, and the latest recorded result per suite. Case catalogue: [`TEST_MATRIX.md`](TEST_MATRIX.md). Suite layout: [`tests/README.md`](../tests/README.md).

**Gate:** local runs are the gate (the labs GitLab host has no CI runners). Counts below are the latest recorded runs, with the commit they ran on. Rows marked **to refresh** must be re-run on the final submission tip before hand-in; they are not re-run in this document.

## 1. Summary

| Suite | What it covers | Latest result | Ran on | Refresh |
| --- | --- | --- | --- | --- |
| Anchor localnet (`tests/**/*.ts`) | Program: mint, settle, admin_settle, redeem, merge_pair, pause, fees, $1 vault invariants, sim session, SimClock, Phoenix on-book sim, prod IDL gates, prod pull-oracle settle | **109 / 109** passing | `dd46769` | to refresh |
| Prod pull-oracle settle (`tests/prod/settle_pull_oracle.ts`, LiteSVM on the prod `.so`) | D-025 accept / reject rules incl. real devnet and mainnet account bytes | **22 / 22** (included in the 109) | `ab3b57c` | to refresh |
| Rust unit (`cargo test`) | Pyth parser helpers | **6 / 6** | DLV-082 branch | to refresh |
| Prod build + fixture assert (`yarn build:prod`) | No `sim_*` / `upsert_mock_pyth` / `test_drain_vault` / SimClock in the prod `.so` or IDL | **PASS** | `0ef2626` | to refresh |
| Automation (`apps/automation`, mocha) | Market-day calendar (DST, holidays, early closes), strikes, operator prices, pull settle, settler / pauser keys, pause monitoring, sim/prod isolation, ops script guards | **228 passing + 13 pending** (pending = opt-in localnet) | MR !92 head (merged as `a5146d4`) | to refresh |
| Automation opt-in localnet (`phoenix-pause.localnet.test.ts`, real Phoenix + Seat Manager) | Handoff, pause at expiry, paused book = cancel / withdraw only | **13 / 13** | DLV-109 (`7e00a6b`) | to refresh |
| Web (`apps/web`, vitest) | Intent availability, ticket wiring, Phoenix sizing / compose / errors, price display, history classification, portfolio reads, fixture gates, dev-wallet gates, hydration guards | **418 passing + 14 skipped** (skipped = opt-in E2E) | MR !92 head (merged as `a5146d4`) | to refresh |
| Web opt-in real-Phoenix E2E (`localnet.hardening.e2e.test.ts`) | Four intents, partial fill, slippage / fill-or-kill, opposite-side block, settle above / below strike, pause; 25 invariant checks per run | **10 / 10** | 2026-10-07 hardening pass (`1915bb7`) | to refresh |
| Web opt-in account E2E (`localnet.account.e2e.test.ts`) | Seat balances, cancel / withdraw, sweep, History from chain | **4 / 4** | `7f8e766` | to refresh |
| Typecheck + lint (web, automation) | `tsc`, `next lint`, `next build` | clean | MR !92 head | to refresh |
| Devnet staging acceptance ([`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md)) | Phantom, real devnet program and books | **Not run** (program not yet on devnet, DLV-077) | — | — |

## 2. How to run

```bash
yarn install

# Program suite (builds with localnet-test, starts its own validator; ~30 min)
yarn test                      # = anchor test -- --features localnet-test

# Prod build + fixture assert
yarn build:prod

# Prod pull-oracle settle on the prod .so (LiteSVM)
yarn build:prod-so && yarn test:prod-settle

# Rust unit tests
cargo test --manifest-path programs/meridian/Cargo.toml

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

The program keypair is not in git. Restore or generate `keys/meridian-keypair.json` whose pubkey matches `declare_id!` ([`keys/README.md`](../keys/README.md)).

## 3. Anchor suite breakdown (109 on `dd46769`)

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
| PULL | `prod/settle_pull_oracle.ts` | 22 | D-025 rules on the prod `.so`, including a non-authority settler |

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

- No component (jsdom) or browser-automation tests for UI flows in the repo; UI flows are covered by logic tests, the opt-in E2E and the manual runbook. See [`PRD_TRACE.md`](PRD_TRACE.md).
- Devnet end-to-end (pull settle with a real Hermes price) not yet run.
- History does not show maker fills by other traders; a resting Sell No does not merge on fill (DLV-069).
