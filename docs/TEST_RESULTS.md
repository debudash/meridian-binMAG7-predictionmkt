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
| **Flake harden** | X-03, SIM-08 (+ suite-wide mint-window slack) | — | **Green** | !34 @ `65c1ddf` (**74/74**) |
| **Total** | — | **74** | **74 passing / 0 failing** | tip `65c1ddf` / docs tip `92d414e` |

Mocha count note: **70** named lifecycle `it()` + **4** S-10 unit vectors = **74** (matches eng !32/!34 reports).

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
| Localnet suite green on tip | Yes — cite `65c1ddf` / `92d414e` |
| Anytime sim path (D-017) | Yes — SIM-01…09; [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |
| Non-custodial / pause / admin delay | Covered by P0 + !17 nits |
| Sell No / `merge_pair` | Green MP-* + client !33 |
| Phoenix on-book sim E2E | **Done** (!38 / DLV-064) — `simTradeOnBook` + PHX-01…06; residual: full Phoenix.so market create on validator ([`phoenix-onbook-sim.md`](phoenix-onbook-sim.md)) |
| Peak6 PRD demo **video** | **Open** (DLV-038) — distinct from this artifact |
| Railway staging deploy | Deferred; fixtures browse OK locally |

**Reviewers:** treat this file + tip SHAs as DLV-039 evidence for demo handoff. Continuous security / walkthrough video remain separate (DLV-037 / DLV-038).

**Post-!38 suite note:** tip advanced with PHX-01…06 under the same mocha `tests/**/*.ts` glob; DLV-039 still cites **74/74** @ `65c1ddf`. Live census after !38 is TBD / re-run (eng reported PHX green separately).

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
