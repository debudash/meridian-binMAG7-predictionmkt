# Meridian test results — Peak6 PRD DLV-039

**Owner:** Meridian Testers (handoff to Meridian Reviewers for demo readiness)  
**Artifact:** Package/report of localnet suite results for Peak6 PRD deliverable **DLV-039**  
**Audience:** Debu / demo handoff / Reviewers  
**Generated:** 2026-10-07 (~09:15 CT)

---

## Executive summary

| Field | Value |
| --- | --- |
| **Result** | **PASS — 74/74 localnet** |
| **Command** | `yarn test` ≡ `anchor test -- --features localnet-test` |
| **Duration (eng !34)** | ~28 minutes |
| **Program id** | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` |
| **Revoked id** | `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (do not use) |
| **Main tip cited** | `92d414e` (Merge !35 docs/tracker-post-34) |
| **Suite-green tip** | `65c1ddf` (Merge !34 eng/flake-timing-x03-sim08) — **74/74** |
| **Prior P2 green tip** | `3051584` (Merge !32) — first **74/74** before flake harden |
| **Forge** | Gauntlet GitLab via `glab` only (D-014) |

**V1 eval gates (see [`EVALS.md`](EVALS.md)):** P0 + P1 + SIM (D-017) + P2/INV + `merge_pair` (D-018) all green on main. Prod fixture hygiene locked by INV-PROD-01 / !17 assert path. No Phoenix matcher invented in Meridian tests.

This artifact cites eng-reported localnet greens on the SHAs above; full suite was **not** re-run in this docs MR (per orchestrator: cite tip SHAs).

---

## Layer rollup

| Layer | Case IDs | Mocha `it()` (approx) | Status | Evidence MRs / SHAs |
| --- | ---: | ---: | --- | --- |
| **P0** mint/settle/redeem/$1 vault/pause | M-01…M-02,M-04…M-06,M-08; S-01…S-07,S-09…S-11; A-01…A-04; R-01…R-04,R-06,R-07,R-09; V-01…V-05; X-01,X-02,X-04…X-06 | ~37 matrix + S-10 vectors | **Green** | !6 → !9 @ eng P0 |
| **P1** fees + edges | M-03, R-05, V-06; S-08, X-03, M-07, M-09, M-10, V-07, V-08 | 10 | **Green** | !10 → !11 |
| **SIM** anytime session (localnet-only) | SIM-01…SIM-09 | 9 | **Green** | !15 → !16; flake harden !34 |
| **MP** `merge_pair` (D-018) | MP-01…MP-08 | 8 | **Green** | !30 → !31 @ `9f175d7` |
| **P2** + INV gates | A-05, R-08, X-07, INV-P2-I3, INV-PROD-01, INV-FEE-TRUNC | 6 | **Green** | !27 suite → !32 @ `3051584` |
| **PHX** Phoenix on-book sim E2E (DLV-064) | PHX-01…PHX-06 (`tests/phoenix_onbook_e2e.ts`) + 3 compose unit cases (`tests/unit/phoenix_compose.ts`) | 6 (+3 unit) | **Green** | !38 — **9/9** focused localnet per !38 report (6 PHX + 3 compose). PHX 6/6 also inside the full-suite **87/87** (hardening pass) and **108/108** (launch-blocker pass @ `0ef2626`) runs below |
| **Flake harden** | X-03, SIM-08 (+ suite-wide mint-window slack) | — | **Green** | !34 @ `65c1ddf` (**74/74**) |
| **Total** | — | **74** | **74 passing / 0 failing** | tip `65c1ddf` / docs tip `92d414e` |

Mocha count note: **70** named lifecycle `it()` + **4** S-10 unit vectors = **74** (matches eng !32/!34 reports).

**Census after !38:** the **74** total is the DLV-039 snapshot @ `65c1ddf`, taken before PHX existed, so it doesn't include the PHX row. Later full-suite runs reported in this file: **87/87** (hardening pass, includes PHX 6) and **108/108** (launch-blocker pass @ `0ef2626`, includes PHX 6 and PULL 21). This census refresh did **not** re-run the suite. PHX counts are per the !38 report and the `it()` count on main.

---

## Cluster detail

### P0 — platinum demo core (D-016)

| Cluster | Cases | Notes |
| --- | --- | --- |
| A Mint | M-01, M-02, M-04, M-05, M-06, M-08 | Pause / not-open / after-expiry / insufficient funds |
| B Settle (Pyth) | S-01…S-07, S-09, S-11 + S-10 unit | Stale/conf/wrong-account/immutable; vault unchanged at settle |
| C Admin settle | A-01…A-04 | Delay / unauthorized / no override |
| D Redeem | R-01…R-04, R-06, R-07, R-09 | Winner-only; partial/full; Open reject |
| E Vault invariants | V-01…V-05 | I1–I3 $1 vault / supply |
| F Pause / e2e | X-01, X-02, X-04, X-05, X-06 | Pause blocks mint/create; settle+redeem OK; I4 |

### P1 — fees + edges

| ID | Expectation | Status |
| --- | --- | --- |
| M-03 / R-05 / V-06 | Fee-on-transfer-in / redeem fee; vault liability equality | Pass |
| S-08 | InvalidPythPrice on zero e6 | Pass |
| X-03 | `admin_settle` while paused (delay elapsed) | Pass (post-!34) |
| M-07 / M-09 / M-10 | Zero amount; missing ATA; multi-user | Pass |
| V-07 | Hostile under-collateralize via localnet `test_drain_vault` | Pass (feature-gated) |
| V-08 | Off-book Yes transfer does not move vault/`pairs_*` | Pass |

### SIM — D-017 anytime open→trade→close→settle→redeem

| ID | Status | Notes |
| --- | --- | --- |
| SIM-01…07, SIM-09 | Pass | Feature-gated `sim_*`; MockPyth; off-book sim trade |
| SIM-08 | Pass (post-!34) | `admin_settle` path after close — Clock sysvar poll |

**Prod rule:** `sim_*` / `upsert_mock_pyth` / `test_drain_vault` **absent** from prod `.so` / `idl/meridian.prod.json` (INV-PROD-01 / !17).

### MP — D-018 `merge_pair`

| ID | Status | Notes |
| --- | --- | --- |
| MP-01…MP-08 | Pass | Open happy; post-expiry OK; pause/settled fail; fee via `redeem_fee_bps`; I2/I3; zero/insufficient; ≠ redeem |

No Phoenix matching engine in Meridian; Sell No = client bid + `merge_pair` (!33).

### P2 + INV (D-018 pins)

| ID | Pin | Status |
| --- | --- | --- |
| A-05 | Policy A → `OutcomeInconsistent` when `outcome_yes != (price_e6 >= strike)` | Pass |
| X-07 | `Settling` discriminant unused/reserved; Open→Settled* only | Pass |
| R-08 | `burn_losing`: loser supply ↓; no USDC; `pairs_redeemed` frozen | Pass |
| INV-P2-I3 | burn_losing preserves vault I3 | Pass |
| INV-PROD-01 | Prod IDL omits fixture ixs | Pass |
| INV-FEE-TRUNC | Fee trunc toward zero | Pass |

---

## Hardening pass 2026-10-07 (CT)

Run 21:05–22:45 CT by Grok Bot (executor) for Debu. Local green was the gate (no CI). Main moved during the pass: started at `74a35e4`, ended at `1915bb7`. Real-Phoenix E2E ran on an isolated validator (`:8799`, fresh `--reset`) so Debu's `:8899` + `:3000` setup stayed intact. Logs are on the box under `/workspace/hardening-20261007/` (not committed).

### Results per area

| Area | Result | Notes |
| --- | --- | --- |
| Anchor localnet-test (P0/P1/P2, SIM, MP merge_pair, SC SimClock, PHX, INV, X) | **PASS 87/87** | Run on main before !57. Counts: A 5, INV 3, M 11, MP 8, PHX 6, R 9, S 14 (S-01…S-09 + S-11 = 10, plus 4 `S-10` vectors), SC 3 + SC-IDL 1, SIM 9, U 3 (`phoenix_compose` unit), V 8, X 7 = **87**. !57 brought its own `tests/prod/settle_pull_oracle.ts` suite; it was not re-run here because the box was loaded. |
| Prod Anchor build + `assert-prod-no-fixtures` | **PASS** | No `sim_*` / `upsert_mock_pyth` / `test_drain_vault` in the prod `.so` or IDL |
| Automation | **PASS 37/37** + tsc | On `1915bb7` (was 17/17 before !57) |
| Web unit | **PASS 161 + 10 skipped** | Skipped tests are the opt-in E2E. tsc, `next lint`, and `next build` are green on `1915bb7` |
| Real-Phoenix E2E (`LOCALNET_E2E=1`, `localnet.hardening.e2e.test.ts`) | **PASS 10/10** | 25 invariant checks after every step: vault == outstanding pairs × $1, and Yes == No supply until settle. Details below |
| UI smoke (headless Chrome, dev wallet, `:3000`) | **PASS** with findings | 18 routes × desktop 1280×800 / mobile 390×844 = 36 combos: all 200, 0 horizontal overflow, 386 controls clicked, 0 failed clicks, selected states visually distinct. !49 payoff line + distance readout and !50 settle proof + "Recently settled (2)" are correct for both an above-strike and a below-strike settle |
| Hydration | **FIXED** | Trade page #425/#422 (!52, DLV-079) and countdown #425/#418 (!60, DLV-086). Prod build shows 0 page errors at browser clock +2m05s / −1h on `/`, `/markets`, and the trade page |
| Security: dev wallet | **FIXED** + 1 residual | A prod build with localnet env served the key (!56, DLV-080). Residual: Host + XFF spoof against `next dev` on `0.0.0.0` (DLV-081) |
| Security: secrets | **PASS** | Repo clean, apart from the historical revoked keypair that is already documented. Client `.next/static` has no keys, tokens, local paths, or fixture instructions. Server chunks contain only Next's own build paths |
| Prod build excludes fixtures | **PARTIAL** | Program and IDL are clean. The web bundle still ships `lib/demo/portfolio`: Portfolio, History, the Header redeem dot, and intent availability use demo data on every cluster (DLV-088). Fixture markets are localnet-only since !59 (DLV-084) |

### Real-Phoenix E2E cases (10/10)

1. Market Buy Yes / Sell Yes / Buy No (mint + ask in one tx) / Sell No (bid + merge_pair in one tx): wallet deltas are exact.
2. A resting limit Buy Yes is partially filled by a second wallet (4/10), and the remainder cancels.
3. A crossing limit Sell Yes fills as taker and lands in the wallet.
4. Opposite-side block: the UI gate blocks Buy No while the wallet holds Yes. The program does not block it (by design).
5. Slippage: a market Buy Yes with worst price below the ask gets no fill and moves no funds.
6. Slippage: a market Sell No that can't fill reverts the whole tx.
7. DLV-070: a market Buy No that can't fully fill reverts the mint too (fill-or-kill, D-024, !54).
8. Lifecycle above: SimClock warp, then settle at strike-touch (≥, D-005) → Yes wins. Winner redeems $1 per contract; loser gets 0.
9. Lifecycle below: settle one cent under the strike → No wins. Winner redeems; loser gets 0.
10. Pause blocks a new Buy No (mint, 6000 Paused) but not Phoenix-only trades. `admin_settle` works after expiry.

To reproduce, use `scripts/e2e/create-lifecycle-markets.ts` plus the local bootstrap/seed scripts on a spare validator port, then run `LOCALNET_E2E=1 npx vitest run src/lib/phoenix/localnet.hardening.e2e.test.ts`.

### Bugs found → fixed (merged)

| MR | Fix | DLV |
| --- | --- | --- |
| !52 | Trade page and landing inline `<style>` (React SSR escapes `>`) → globals.css. A guard test bans `<style>{…}` | DLV-079 |
| !53 | Docs renumber (collided with !51) | — |
| !54 | Market IOC is fill-or-kill (`minBaseUnitsToFill = size`), so there is no Buy No under-fill and no silent 0-fill. Plain-language error toasts. Adds the real-Phoenix hardening E2E | DLV-070, D-024 |
| !55 | The E2E no longer pulls `apps/automation` into web tsc / `next build` | — |
| !56 | The dev wallet can never turn on when `NODE_ENV=production`, and the forwarded client must be loopback | DLV-080 |
| !60 | Countdowns hydrate with the server render time (`serverNowSec` → `ChainClockProvider` until mounted) | DLV-086 |

### Open risks / new items

- **DLV-081 (localnet only):** dev-wallet route trusts Host + XFF. Bind `next dev -H 127.0.0.1`.
- **DLV-087:** resting limit fills credit the Phoenix seat (`baseLotsFree`), not the wallet. The UI has no cancel/withdraw, Portfolio doesn't show seat balances, and availability allowed Buy No while 4 Yes sat in the seat.
- **DLV-088:** demo portfolio, history, Header redeem dot, and intent availability use `lib/demo/portfolio` on every cluster. A real devnet wallet sees fake positions and a fake redeem dot.
- **DLV-089 (minor):** favicon 404 on every page. `/markets/<unknown>` renders "Market not found" with HTTP 200 (streamed). The settle proof says "Settle tx not found in RPC history" on localnet.
- **DLV-090 (observability):** RPC read errors in `listFromLive` / `getMarket` are swallowed without a log. Under load (box load ~15–18), two localnet prod builds silently served fixture markets until a later request. Off-localnet this now shows "Markets unavailable" (!59), but the cause is still invisible in server logs.
- **DLV-085 (owned by the parallel stream):** Hermes API key is needed for permissionless settle off-localnet. `admin_settle` is the fallback.

### Review of !43–!50 (self-review; SendToAgent unavailable)

- **Test gaps:** there are no component/jsdom tests, so UI behaviour is covered only by the smoke script plus pure-function tests. The real-Phoenix E2E is opt-in and depends on local-only bootstrap/seed scripts. Nothing in CI exercises the dev-wallet route in a prod build. Only !56's unit tests cover it.
- **!43 Phoenix order path:** correct against real V1 books. Before !54, market IOC could under-fill.
- **!44 dev wallet:** gating relied on env + loopback only. Fixed in !56; DLV-081 residual.
- **!45–!47 selection / layout / states:** no functional issues. Selected states are distinct on desktop and mobile.
- **!48 exposure-aware Buy buttons:** uses wallet balances only, so it misses seat balances (DLV-087) and the demo data (DLV-088).
- **!49 payoff line / distance:** numbers are correct (10 @ 0.45 → +$5.50 / −$4.50).
- **!50 settle proof / Recently settled:** correct for above and below settles. Missing tx history is labelled honestly.
- **Architecture:** the committed prod IDL lists the optional `sim_clock` account (harmless on prod). Anchor TS auto-resolves the SimClock PDA, so on any chain where SimClock is enabled, every mint/settle uses sim time. This is intended for localnet; make sure SimClock is never initialised on devnet.

### Go / no-go

- **Devnet + Railway staging (internal demo): GO.** Conditions:
  - deploy the prod `.so` (DLV-077, blocked on devnet SOL);
  - settle via `admin_settle`, or automation with `PYTH_HERMES_API_KEY` (DLV-085);
  - testers are told Portfolio/History are demo data (DLV-088);
  - limit orders that rest and fill need a manual seat withdraw (DLV-087).
- **Public / mainnet: NO-GO** until DLV-088 and DLV-087 are done, the pull-oracle settle is proven on devnet end-to-end, and an external security review is complete.

---

## Launch-blocker pass 2026-10-07 (CT, after the hardening pass)

Run 22:20–23:30 CT by Grok Bot (executor). Local green was the gate (no CI). Temp validators: Anchor suite on `:8699`, real-Phoenix account E2E on `:8799`; both stopped afterwards. Debu's `:8899` / `:3000` and the staging watcher were not touched.

| Area | Result | Notes |
| --- | --- | --- |
| Anchor localnet-test, full `tests/**/*.ts` | **PASS 108/108** (27 min) | On main `0ef2626` (programs unchanged through `7f8e766`). Counts: A 5, INV 3, M 11, MP 8, PHX 6, PULL 21 (`tests/prod/settle_pull_oracle.ts` on `target/prod/meridian.so`), R 9, S 14 (10 + 4 `S-10` vectors), SC 3 + SC-IDL 1, SIM 9, U 3 (`phoenix_compose` unit), V 8, X 7 = **108** |
| Automation | **PASS 37/37** + tsc | On `7f8e766` |
| Web unit | **PASS 252 + 14 skipped** | The 14 skipped are the two opt-in real-Phoenix E2E files. tsc, `next lint`, and `next build` are green on the !63 head |
| Real-Phoenix account E2E (`LOCALNET_E2E=1`, `src/lib/portfolio/localnet.account.e2e.test.ts`) | **PASS 4/4** | (1) Partial maker fill: seat holds 4 Yes, 6 still resting; `availabilityInputs` gives Yes held = wallet + 4 and resting Buy Yes = 6 → Buy No blocked; Cancel (UI path `submitPhoenixManage`) empties the seat, puts the 4 Yes in the wallet, and returns 6 × px USDC. (2) Withdraw-only moves seat Yes and keeps the order resting; seat Yes is sold by a market Sell Yes thanks to the prepended sweep. (3) A resting Sell No locks No. (4) History classifies trade / order / cancel / withdraw from chain |

MRs: !62 → `20b06c7` (DLV-090 / 089 / 081), !63 → `7f8e766` (DLV-088 / 087 / 068).

### Go / no-go (updated)

- **Devnet + Railway staging (internal demo): GO.** Still needs the prod `.so` deploy (DLV-077, devnet SOL) and `admin_settle` or `PYTH_HERMES_API_KEY` (DLV-085). Portfolio / History are now real on-chain data.
- **Public / mainnet: NO-GO** until the pull-oracle settle is proven end-to-end on devnet (Hermes key) and an external security review is done. DLV-087 / DLV-088 are no longer blockers. Known gaps:
  - History misses maker fills by other traders;
  - a resting Sell No does not merge on fill (DLV-069);
  - localnet settle-proof lookup (DLV-089 residual).

---

## Flake evidence (X-03 / SIM-08 → !34)

| Event | Tip | Result | Notes |
| --- | --- | --- | --- |
| Pre-harden check | `3051584` (!32) | **72/74** | X-03 mint-before-expiry race (`expiryTs=now+2` lost to RPC latency); SIM-08 wall-clock wait vs lagging validator Clock → `AdminSettleTooEarly` |
| Eng harden | !34 `eng/flake-timing-x03-sim08` → merge `65c1ddf` | **74/74** | Harness-only: `EXPIRY_MINT_SLACK_SECS=30` / `expiryAfterMintSlack()`; `waitPastExpiry` polls Clock sysvar; suite-wide mint-window slack; Mocha timeout 240s |
| Docs tip | `92d414e` (!35) | — | TRACKER sync post-!34; no suite delta |

**Not product defects** for demo: timing/validator-clock harness races only. No prod program / A-05 / X-07 / `merge_pair` / apps/web changes in !34. SimClock PDA (D-017) still deferred (not required by SIM-01…09).

---

## How to reproduce

```bash
export GITLAB_HOST=labs.gauntletai.com
# clone tip main @ 92d414e (or newer)
yarn install
# keypair: keys/meridian-keypair.json whose pubkey == program id (gitignored) — see keys/README.md
yarn test
# or: anchor test -- --features localnet-test

# Prod fixture hygiene (optional companion log for PRD):
yarn build:prod
```

Expect: **74 passing / 0 failing**. Labs CI runners may be absent — Debu don't-wait (same as !34 test plan).

---

## Demo readiness notes (for Reviewers)

| Item | State |
| --- | --- |
| Localnet suite green on tip | Yes — DLV-039 snapshot 74/74 @ `65c1ddf` / `92d414e`. Latest reported full suite **108/108** @ `0ef2626` (launch-blocker pass; programs unchanged through `7f8e766`) |
| Anytime sim path (D-017) | Yes — SIM-01…09; [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |
| Non-custodial / pause / admin delay | Covered by P0 + !17 nits |
| Sell No / `merge_pair` | Green MP-* + client !33 |
| Phoenix on-book sim E2E | **Done / Green** (!38 / DLV-064). `simTradeOnBook` + **PHX-01…06**: 6/6 PHX, 9/9 with the 3 compose unit cases per !38. PHX 6 green inside the 87/87 and 108/108 full-suite runs. Real Phoenix V1 books are also covered by the opt-in web E2E (hardening 10/10, account 4/4). Residual: Phoenix.so market create inside the Anchor mocha harness ([`phoenix-onbook-sim.md`](phoenix-onbook-sim.md)) |
| Peak6 PRD demo **video** | **Open** (DLV-038) — distinct from this artifact |
| Railway staging deploy | Deferred; fixtures browse OK locally |

**Reviewers:** treat this file + tip SHAs as DLV-039 evidence for demo handoff. Continuous security / walkthrough video remain separate (DLV-037 / DLV-038).

**Post-!38 suite note (refreshed):** PHX-01…06 are 6 `it()` cases in `tests/phoenix_onbook_e2e.ts`, plus 3 compose unit cases in `tests/unit/phoenix_compose.ts`. Both sit under the mocha `tests/**/*.ts` glob (`Anchor.toml`). Counts: 9/9 focused per !38; PHX 6 in the full-suite 87/87 and 108/108 runs recorded above. DLV-039's own snapshot stays **74/74** @ `65c1ddf`. Not re-run in this refresh.

---

## Related docs

- [`TEST_MATRIX.md`](TEST_MATRIX.md) — case source of truth  
- [`EVALS.md`](EVALS.md) — V1 pass bar  
- [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) — walkthrough  
- [`SIM_LIFECYCLE.md`](SIM_LIFECYCLE.md) — one-command sim automation  
- [`tests/README.md`](../tests/README.md) — suite layout  
- [`TRACKER.md`](TRACKER.md) — kanban  

---

## Changelog

| Date | Actor | Change |
| --- | --- | --- |
| 2026-10-07 | Meridian Testers | Initial DLV-039 artifact from tip `92d414e` / suite green `65c1ddf` (!34) |
| 2026-10-07 | Meridian Orchestrator / Reviewers | Demo table: Phoenix on-book → Done (!38 / DLV-064); residual Phoenix.so create; post-!38 PHX census TBD; tip note `bcf5d23` |
| 2026-10-07 | Grok Bot (hardening executor) | Hardening pass section (21:05–22:45 CT): per-area results, E2E 10/10, fixes !52–!56 + !60, DLV-086–090, go/no-go |
| 2026-10-07 | Grok Bot (launch-blocker executor) | Launch-blocker pass: Anchor 108/108 on main, automation 37/37, web 252, account E2E 4/4; !62 + !63 (DLV-081/087/088/089/090, DLV-068); go/no-go updated |
| 2026-10-07 | Meridian Testers | Census refresh for PHX-01…06 (!38): PHX row in the layer rollup (6 PHX + 3 compose; 9/9 per !38; PHX 6 in 87/87 and 108/108), Phoenix on-book demo row → Done / Green, post-!38 note rewritten (TBD removed). No suite re-run. Requested by Meridian Reviewers |
| 2026-10-07 | Meridian Testers | Count nit (Reviewers, !66 note): the per-prefix breakdowns in the hardening row and the launch-blocker row summed to 86 and 107, not the 87 and 108 they headline. **The headline totals are right.** The launch-blocker mocha log reports `108 passing (27m)`. The hardening run's two logs (66 ✔, then a re-run of settle → S-10 with `33 passing`) give 87 unique passing cases. The Reviewers' static `it()` census at `ea84698` also reconciles to 108, and 108 − PULL 21 = 87. The breakdowns were mis-bucketed: there's no `B`-prefixed case (`B 1` removed); S is 14, not 15 (S-01…S-09 + S-11 = 10, plus the 4 `S-10` loop vectors); and the 3 `tests/unit/phoenix_compose.ts` cases had no bucket (`U 3` added). Each row now adds up. No suite re-run |
