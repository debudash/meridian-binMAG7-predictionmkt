# Meridian AI decision log

Append-only log of agent decisions and orchestration events for Peak6 Meridian.
Timestamps are America/Chicago (CDT, UTC-5). Newest entries at the top.
Narrative detail lives here; locked decisions are indexed in [`DECISIONS.md`](DECISIONS.md).

---

## 2026-10-07T07:49:46-05:00 — Engineers: harden X-03 / SIM-08 localnet timing flakes

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/flake-timing-x03-sim08` rebased onto `origin/main` @ `5e30749` (!33 Sell No) |
| **Decision** | Harness-only flake fix (no prod program / A-05 / X-07 / merge_pair / apps/web changes). **X-03:** `now+2` → `expiryAfterMintSlack()` (`EXPIRY_MINT_SLACK_SECS=30`) so create+mint cannot race `MintAfterExpiry`. **SIM-08:** `waitPastExpiry` polls validator **Clock sysvar** until `unix_timestamp >= expiry[+delay]+2` (wall sleep alone lagged localnet Clock → `AdminSettleTooEarly`). Suite-wide mint-before-expiry slack: S-08/V-07, SIM-05…08, settle openMintThenExpire/A-01…A-03, fees V-06, pause X-02/X-04…X-06, redeem, invariants, merge_pair MP-*, p2_gates. Anchor/mocha timeout 240s. SimClock PDA (D-017) still deferred. Program id unchanged `9Rb7nx…`. |
| **Files** | `tests/helpers/fixtures.ts` · `tests/helpers/harness.ts` · `tests/{p1_edges,sim_session,settle,fees,pause,redeem,invariants,merge_pair,p2_gates}.ts` · `Anchor.toml` · `docs/AI_LOG.md` |
| **Related** | D-016 · D-017 · localnet tip was `3051584` 72/74 · !32 P2 · !33 Sell No |

---

## 2026-10-07T07:45:00-05:00 — Engineers: Sell No merge_pair client + size unify (Reviewer Highs)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/sell-no-merge-size` from `origin/main` @ `3051584` |
| **Decision** | Land Reviewer CONDITIONAL PASS Highs: (1) `buildMergeIx` + Sell No immediate `phoenix-then-merge` (market); resting limit/post-only keeps honest merge-on-fill caveat; fix stale “no merge ix / Schema TODO” copy. (2) Unify `contractsToRawAmounts` so mint raw == Phoenix `sizeInBaseUnits` (decimals=6 atoms). Medium: `PAUSE_BLOCKS` += `merge_pair`. No program id / keypair changes. |
| **Result** | web vitest green; resting merge-on-fill still phased. |
| **Files** | `apps/web/src/lib/solana/instructions.ts` · `phoenix/{compose,client,config,types,size}.ts` · `TradeTicket.tsx` · `tests/helpers/invariants.ts` · TRACKER/AI_LOG/DEMO_SCRIPT |
| **Related** | D-018 · Reviewer `/workspace/meridian-review-main-3051584.md` · !28 · !31 · !32 |

---

## 2026-10-07T00:30:00-05:00 — Engineers: green P2 A-05/R-08/X-07 + INV gates (D-018)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/p2-invariant-gates` from `origin/test/p2-invariant-gates` @ `1f6fc77`, rebased onto `main` @ `9f175d7` (!31 merge_pair) |
| **Decision** | Implement Schema **D-018** P2 slices only: A-05 **Policy A** (`OutcomeInconsistent`) + X-07 **retire Settling** (unused/reserved; discriminant kept; Open-only `is_open`). **Did not** re-implement `merge_pair` (already green on main !31). No Phoenix matcher. Program id unchanged `9Rb7nx…`. |
| **Impl** | `errors.rs` + `admin_settle.rs` consistency check; X-07 suite flip documenting retirement; R-08 / INV-* via existing `burn_losing` + fee trunc / prod IDL. `waitPastExpiry` +1.5s slack (localnet Clock lag). |
| **Result** | Localnet **74 passing / 0 failing** (P0/P1/SIM + MP-01…08 + P2 A-05/R-08/X-07 + INV-*). |
| **Related** | D-016 · D-018 · !27 suite · !31 merge_pair · TEST_MATRIX Cluster H |

---

## 2026-10-07T00:19:00-05:00 — Eng: prod merge_pair greens MP-01…MP-08 (D-018)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Decision** | Implement prod **`merge_pair(amount)`** (D-018 / Schema !29): burn equal Yes+No; vault pays `amount − redeem_fee_bps` (fee→treasury); `pairs_minted −= amount`; emit `Merged`. Pause blocks; **no expiry gate** (OK after `expiry_ts` while Open); settled → `MarketNotOpen`. Distinct from `redeem` / `burn_losing`. Not localnet-gated — appears in `idl/meridian.prod.json`. Harness `mergePair` already wired by Testers !30 — Eng only landed Rust ix + IDL; did **not** rewrite MP asserts. **Did not** touch A-05 / X-07 (P2 !27). No Phoenix matcher. |
| **Result** | Localnet **68 passing / 0 failing** (P0/P1/SIM + Cluster I MP-01…08). Branch `eng/merge-pair` from `origin/test/merge-pair-failing` @ `5c8c00d` (same stack pattern as !10→!11). |
| **Files** | `programs/meridian/src/instructions/merge_pair.rs` · `lib.rs` / `mod.rs` / `events.rs` · `idl/meridian.json` + `meridian.prod.json` (+ apps sync) · `tests/helpers/harness.ts` (`EXPECTED_INSTRUCTIONS`) · `docs/TEST_MATRIX.md` · `docs/TRACKER.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · D-016 · Testers !30 · Schema !29 · program id `9Rb7nx…` |

---

## 2026-10-07T00:06:00-05:00 — Testers: merge_pair red suite (D-018 / MP-01…MP-08)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Decision** | Land failing suite for prod **`merge_pair`** (Schema !29 / D-018) on branch `test/merge-pair-failing` from `schema/merge-pair` tip. Cases **MP-01…MP-08**: Open happy; post-expiry OK; pause fails; settled fails; fee-on-payout (`redeem_fee_bps`); I2/I3; zero/insufficient; distinct from redeem. Harness `mergePair` → **TDD_RED** until IDL lands. Meridian tests only `merge_pair` — no Phoenix matcher. **Coordination:** A-05 Policy A + X-07 Settling retire covered by P2 suite !27; Schema !29 docs align — do **not** double-flip those in this MR. Eng implements only after this red suite (D-016). |
| **Files** | `tests/merge_pair.ts` · `tests/helpers/harness.ts` · `docs/TEST_MATRIX.md` · `tests/README.md` · `docs/TRACKER.md` · `docs/TASKS.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · D-016 · Schema !29 · P2 !27 · tip program id `9Rb7nx…` |

---
## 2026-10-07T00:05:00-05:00 — D-018 merge_pair + Settling retire + admin_settle Policy A

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | **D-018:** Lock prod ix **`merge_pair`** (not `burn_pair`; not localnet-gated) as Open-state inverse of `mint`: burn `amount` Yes+No, pay `collateral_out = amount − fee` with `fee = amount * redeem_fee_bps / 10_000` (fee-on-payout → treasury), require `vault.amount >= amount`, decrement **`pairs_minted`** (redefined while Open as outstanding pair liability: +mint / −merge). Pause blocks merge like mint/create. **Allow merge after `expiry_ts`** while `status == Open` (only status+pause matter; contrast mint's expiry gate). Event `Merged { market, user, amount, fee, pairs_minted_after }`. Distinct from `burn_losing` / `redeem`. Client: Meridian does **not** wrap Phoenix — **Buy No** = `mint` + ask Yes @ `1−p_no` (!28); **Sell No** = bid Yes @ `1−p_no` then `merge_pair` (same tx if immediate; resting = bid, merge on fill). Resolved UI 06 Buy/Sell No mechanism TODOs. **X-07:** status `1` `Settling` = unused/reserved; state machine Open → SettledYes / SettledNo / Void only. **A-05 Policy A:** `admin_settle` requires `outcome_yes == (settlement_price_e6 >= strike_price_e6)` else `OutcomeInconsistent`. |
| **Files** | `docs/SCHEMA.md` · `docs/accounts.md` · `docs/flows.md` · `programs/meridian/README.md` · `docs/ui/06-trading-intents-and-constraints.md` · `docs/DECISIONS.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · Eng !28 Sell No ask · UI 06 · X-07 · A-05 · D-015 Phoenix V1 · D-014 glab |

---

## 2026-10-06T23:55:00-05:00 — Phoenix place + indexer beyond stubs (Eng)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers / Grok Bot |
| **Decision** | Land Phoenix placement path with `@ellipsis-labs/phoenix-sdk`: Buy/Sell Yes bid/ask; Buy No = mint + ask Yes @ `1−p_no`; Sell No = bid Yes only — **merge Yes+No→USDC remains Schema TODO** (no merge ix in prod IDL). Indexer: HTTP `NEXT_PUBLIC_INDEXER_URL` → RPC `StrikeMarket` GPA → fixtures+banner. Railway staging **env templates only** (no project create). |
| **SDK** | `@ellipsis-labs/phoenix-sdk@2.0.3` |
| **Gated** | Live place needs wallet + `phoenixMarket` pubkey and not `NEXT_PUBLIC_PHOENIX_ENABLED=false`; Buy No mint needs vault/mints/treasury on MarketView; seat claim via maker-setup ixs. |
| **Related** | D-014 · D-015 · SPEC §3.4 · `docs/ui/06` · branch `eng/phoenix-place-indexer` |

---
## 2026-10-06T23:55:00-05:00 — Testers: P2 + invariant gates TDD suite

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (`glab` commits API) |
| **Decision** | Land failing/pinning P2 suite on `test/p2-invariant-gates` from tip `main` (program id `9Rb7nx…`). Cases: **A-05** (prefer reject inconsistent `outcome_yes` vs price/strike; XOR accept+log + DECISIONS), **R-08** (`burn_losing`), **X-07** (Settling unused — pin or retire), **INV-P2-I3** / **INV-PROD-01** / **INV-FEE-TRUNC**. Harness adds `burnLosing`. No Rust; no Phoenix matcher; no P0/P1/SIM re-impl. |
| **Result** | Suite MR for Engineers to green (D-016). |
| **Related** | D-016 · TEST_MATRIX · !25 program-id · !16 SIM green |

## 2026-10-06T23:52:00-05:00 — SPEC lock confirmed on main (!20 @ aa97a22)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM / Grok Bot (post-merge TRACKER/AI_LOG sync) |
| **Decision** | Confirm Debu-authorized **SPEC lock** + **wireframe approval** recorded on main after !20 merge. Revise-later OK. No new DECISIONS row / no D-018. |
| **Merge** | `aa97a22b85b1ba4a85571ff8c1d15969e864b4e1` — Merge branch `docs/d012-spec-freeze` into `main` |
| **Related** | D-012 · MR !20 · TRACKER Done (SPEC + wireframes) · open !25 |

---

## 2026-10-06T23:50:00-05:00 — SPEC lock (Debu authorized; MR !20)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (lock); Grok Bot (record + merge `docs/d012-spec-freeze` !20) |
| **Decision** | **Lock** `docs/SPEC.md` (status → **Locked**). Debu authorized lock **without full review**; **wireframes approved all** (Landing/Markets/Trade/Portfolio/History under `docs/ui/wireframes/`). TRACKER: SPEC + D-012 stubs + wireframes → **Done/locked**. No new DECISIONS D-0xx invented for the freeze. |
| **History scrub** | Debu **skipped** full history scrub question. Tip-delete of committed keypair already done in !24. **Do not** force-push / filter-repo / BFG. |
| **Status at record time** | !20 **merged** onto `main` @ `aa97a22b85b1ba4a85571ff8c1d15969e864b4e1` (merge commit; head `124c074`). `docs/SPEC.md` **Locked** on main; wireframes under `docs/ui/wireframes/`. No D-018. Open residual: !25 (`test/program-id-rotate`). |
| **Related** | D-012 · MR !20 · !24 tip-delete · TRACKER SPEC Done |

---

## 2026-10-06T23:44:00-05:00 — Testers: suite points at rotated program id (!24)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (`glab` commits API) |
| **Decision** | Confirm harness/fixtures + suite docs track Engineers' program-id rotate on `main` @ `59bfdd5` (!24). **Current:** `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6`. **Revoked:** `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2`. `MERIDIAN_PROGRAM_ID` already updated in !24; Testers document gitignored keypair + localnet redeploy recipe in `tests/README.md` / fixture comment. **Do not** change Rust `declare_id!` (Engineers). |
| **Result** | Branch `test/program-id-rotate` → MR to `main`. Engineers: redeploy localnet with new keypair (pubkey must match); wipe old program accounts if validator reused. |
| **Related** | !24 `eng/sec-keypair-railway` · `keys/README.md` · D-014 |

---

## 2026-10-06T23:41:09-05:00 — SECURITY: rotate compromised program keypair + Railway IDL/health

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (eng; Debu authorized urgent land — don't wait) |
| **Branch** | `eng/sec-keypair-railway` |
| **Finding** | `keys/meridian-keypair.json` was committed → pubkey `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` treated as **compromised / revoked**. |
| **Actions** | (1) `git rm` secret key file; gitignore `keys/*` + `**/*keypair*.json` (keep `keys/README.md` pubkey-only policy). (2) **Rotate** program id to `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` — update `declare_id!`, `Anchor.toml`, IDL `address`, apps defaults, DEPLOY. New secret stays gitignored under `keys/meridian-keypair.json` on deploy boxes only — **never commit**. (3) Railway automation: bake `apps/automation/idl/meridian.prod.json`; default `MERIDIAN_IDL_PATH=idl/meridian.prod.json`; `/health` + `healthcheckPath`; `build:railway` strips sim. (4) Railway web: `apps/web/railway.json` + `/api/health`. (5) `emit-prod-idl.js` syncs web+automation copies; strips `MockPythParams`; `assert-idl-sync`. |
| **History scrub** | GitLab history **still contains** the old key bytes until Debu runs `git filter-repo` / BFG + force-push on `main`. This MR deletes from tree + documents revoke; does **not** force-push. |
| **Rationale** | Reviewer apps report High: committed deploy key + Railway IDL path break on `rootDirectory=apps/automation`. |

---
## 2026-10-06 23:40 CT — eng: UI nits post-!22 (`eng/ui-nits-post-22`)

**Agent:** Meridian Engineers (executor)  
**Branch:** `eng/ui-nits-post-22` from `origin/main` @ `b6540e6` (worktree `/workspace/peak6-meridian-ui-nits`)

### What landed (apps/web only — Phoenix place/cancel stubs untouched)
1. **MarketsClient** — Cards|Table|Ladder toggle; Underlying multi-select + Expiry chips; URL `view`/`u`/`expiry`
2. **MarketCard** — Buy Yes/No via `useIntentAvailability`; “You: Yes N” / “You: No N” badge
3. **TradeClient** — demo position into constraint; Zone E Position/Open orders/Fills; chart stub labeled; `?side=` kept on perspective toggle; book click → ticket price
4. **TradeTicket** — Post-only checkbox under Limit (06 §1.1)
5. **OrderBook** — `onSelectPrice` wired; bid/ask use `--bid`/`--ask` (not Yes/No accents)
6. **Hook** — `useIntentAvailability(marketId)` + demo-wiring unit tests; pure fn + tests kept
7. **Portfolio** — summary bar (USDC, uPnL, Redeem all, unsettled Phoenix); `?tab=` URL sync
8. **History** — market/date/side filters; richer columns; CSV export (fixture data)
9. **Header** — redeemable nav dot; mobile bottom tabs
10. **Global** — wrong-cluster + program-paused banners; stub `/terms` + `/risk`

### Hard constraints
- `idl/meridian.prod.json` only; no localnet-test / fixture ixs in bundle
- Did **not** touch keys/, .gitignore keys rules, railway.json, emit-prod-idl, IDL Railway copies (parallel security MR)
- Phoenix stubs left alone

### Checks
- `npm test --prefix apps/web`: 23 passed
- typecheck + lint + build: run on branch before MR

### Related
- Meridian UI review of !22 · docs/ui 02–07 · wireframes !20

---

## 2026-10-06 21:40 CT — eng: Next.js UI V1 scaffold (`eng/nextjs-ui`)

**Agent:** Meridian Engineers (executor)  
**Branch:** `eng/nextjs-ui` from `origin/main` @ `823e6fd` (new worktree `/workspace/peak6-meridian-web`; did not reuse dirty/unrelated eng worktrees)

### What landed
- `apps/web/` Next.js 14 App Router + TypeScript package consuming `docs/ui/*`
- Routes: `/`, `/markets`, `/markets/[marketId]`, `/portfolio`, `/history`, `/rules`
- Providers: Connection → Wallet → QueryClient → ChainClock → TxStatus → Pyth shell
- Solana client wraps Anchor Program from **`idl/meridian.prod.json` only** (copied into `apps/web/src/idl/`); program id `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (env-overridable)
- Wired `mint` / `redeem` builders matching prod IDL accounts; settle status read helper; create_strike left to automation
- Pure `getIntentAvailability` + Vitest covering §2.1 matrix and key §2.4 cases (16 tests)
- Trade ticket intent mapping + order book UI shell; Phoenix order placement **stubbed** (`TODO(phoenix)`)
- Markets/landing use mock fixtures when no indexer (Schema OPEN for registry)
- Portfolio redeem CTA calls `redeem` when on-chain accounts + `NEXT_PUBLIC_USDC_MINT` present; fixtures explain stub
- `.env.example` with `NEXT_PUBLIC_*` only; README + root scripts `web:dev` / `web:build` / `web:test` / `web:typecheck`
- TRACKER: Next.js UI moved Todo → In Progress

### Hard constraints honored
- No `localnet-test` / mock Pyth / `sim_*` / `test_drain_vault` in web source or prod bundle
- Anchor program / tests untouched
- Did not invent Schema TODOs as on-chain facts

### Checks
- `npm test` (apps/web): 16 passed
- `npm run typecheck` / `lint` / `build`: green

### Stubbed / follow-ups
- Full Phoenix SDK place/cancel/seat
- Indexer-backed market registry, history, cost basis
- Live Pyth Hermes subscription
- Real on-chain position balances (demo fixtures for SSR)

---

## 2026-10-06T21:35:00-05:00 — Node automation dual-mode (calendar ET + sim)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/node-automation`) |
| **Decision** | Land Railway-ready `apps/automation` with **dual mode (D-017)**: (1) **calendar** worker — morning `create_strike_market` (~08:00 America/New_York) + optional `set_phoenix_market`, settle retries with real Pyth after ≥16:00 ET, `admin_settle` only with authority after delay/retries; (2) **sim** — separate `sim-lifecycle` entry, localnet-only, `sim_open_session`/`sim_close_session` + mock Pyth. Prod entry loads **`idl/meridian.prod.json` only**; client refuses fixture IDL off localnet. Sim module never imported by worker. Phoenix market create stubbed (TODO); strikes = prior-close ± offsets placeholder. Docs: `SIM_LIFECYCLE.md`, DEPLOY §4 pointer, TRACKER automation items → In Progress. |
| **Result** | Package + unit tests (ET gates, mode isolation, strike encoding). MR open — do not merge until review. |
| **Related** | D-014 · D-017 · DEPLOY !18 · SIM !16 · TRACKER automation todos |

---

## 2026-10-06T21:30:00-05:00 — D-012 SPEC freeze candidate + remaining stubs (Meridian PM)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM; Grok Bot (`docs/d012-spec-freeze`) |
| **Decision** | Land freeze-ready `docs/SPEC.md` (status: **Freeze candidate**, awaiting Debu lock ping) plus remaining D-012 artifacts: AGENTS, ARCHITECTURE, TASKS, DEMO_SCRIPT, EVALS, METRICS, RED_TEAM, DIAGRAMS, CONTEXT, CLAUDE, ORCHESTRATOR_KICKOFF. Root README gains Docs map. TRACKER: SPEC moved from “not ready” → freeze candidate In Progress; D-012 stubs Done; Railway noted as prod app/automation target; !19 already on main. No new DECISIONS row — SPEC freeze candidate landed; Debu lock pending (prefer AI_LOG/TRACKER over inventing D-018). |
| **Constraints honored** | GitLab-only + glab (D-014); Phoenix V1 spot (D-015); TDD (D-016); Anytime sim hard acceptance (D-017); no regulatory claims; Todo/In Progress/Done only. |
| **Related** | D-012 · D-014…D-017 · DEPLOY Railway · MR !19 already merged |

---

## 2026-10-06T21:26:00-05:00 — Landed !14–!18 on main (glab merge order)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (glab; Debu-authorized land) |
| **Decision** | Strict merge order: !14 SimClock docs → !15 SIM suite → !16 SIM green → !17 Reviewer nits → !18 CI+DEPLOY. Rebased each onto current `main` (force-with-lease) when behind; merged via `glab mr merge --auto-merge=false` (CI runners may be absent). Localnet suite already reported **60/60** on !16. |
| **Merge SHAs** | !14 `b5a82a426016` · !15 `e2305976de0c` · !16 `84b8d67d0fb7` · !17 `5246e4137568` · !18 `28efa3865f13` |
| **TRACKER** | Synced post-land; `SPEC.md` still **not ready**. |
| **Related** | D-014 · D-017 · MRs !14–!18 |

---

## 2026-10-06T20:20:00-05:00 — CI + DEPLOY ladder (Railway / localnet→devnet→prod)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/ci-deploy`) |
| **Decision** | Land `.gitlab-ci.yml` (`prod-build-no-fixtures` + `localnet-anchor-test` with Solana/Anchor cache) and `docs/DEPLOY.md` describing Debu's ladder: localnet (box+CI) → devnet staging (prod build, real Pyth/Phoenix) → Railway staging→devnet → Railway prod. Railway runs Next.js + Node automation only; program deploys on-chain separately. **Forbidden:** `--features localnet-test` on devnet/mainnet. Includes Reviewer deploy checklist + prod IDL/`.so` fixture assert scripts. |
| **Result** | Branch + MR for ops/CI contract. Runner availability on `labs.gauntletai.com` may be none — YAML still lands. |
| **Related** | Reviewer-nits !17 · SIM !16 · D-017 |

## 2026-10-06T20:10:00-05:00 — Reviewer nits: real Pyth prod path + fee caps + prod IDL

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/reviewer-nits-pyth-idl`) |
| **Decision** | Land Reviewer approve-with-nits on main @ 14d6928: (1) **HIGH** settle decoder — `load_pyth_price` mock under `localnet-test` only; prod parses legacy Pyth Price magic `0xa1b2c3d4` and **rejects** mock magic. (2) **MEDIUM** `idl/meridian.prod.json` via `scripts/emit-prod-idl.js` + `scripts/assert-prod-no-fixtures.sh` (`yarn build:prod`). (3) **MEDIUM** `update_config` fee cap `MAX_FEE_BPS=1000`; prod-only timelock `CONFIG_TIMELOCK_SECS=3600` + min admin delay 60s (`#[cfg(not(feature = "localnet-test"))]`); localnet suite unchanged. (4) Redeem `user_collateral_ata` mint == `config.collateral_mint`. Deploy forbid note in program README — full ladder in follow-up `eng/ci-deploy`. |
| **Result** | `anchor test -- --features localnet-test`: **51/51**. Prod `.so` + prod IDL assert: no fixture strings. |
| **Related** | Review report `/workspace/meridian-review-main-14d6928.md` · SIM eng !16 · D-017 |

## 2026-10-06T20:10:00-05:00 — Testers nits on MR !16 (SIM expiry + header)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (push `eng/sim-session` → !16) |
| **Decision** | Approve-with-nits: (1) SIM-06/07 expiry buffers **+20s** (match SIM-05/08; create/simOpen race). (2) Refresh `tests/sim_session.ts` header — no longer TDD_RED; documents GREEN eng fixtures + localnet-only gate. Optional: CI prod `.so`/IDL fixture strings gate already in **MR !18** (`eng/ci-deploy`); `build:prod` / `deploy:build` = `anchor build` (no features) only. |
| **Result** | `anchor test -- --features localnet-test`: **60 passing / 0 failing**. |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/16 |

---

## 2026-10-06T19:55:00-05:00 — Eng green Cluster G sim session (SIM-01…09)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab on `eng/sim-session`) |
| **Decision** | Green Testers MR !15 suite: `sim_open_session` / `sim_close_session` under `#[cfg(feature = "localnet-test")]`; `StrikeMarket.trading_open` (default **true** on create) + `sim_armed` (set by sim_open so P0/P1 settle-without-close stays green; SIM-05 SessionNotClosed only after sim_open). Errors `TradingClosed` / `SessionNotClosed`. Mint gates on `trading_open`. Sim trade = harness off-book Yes SPL transfer (no Meridian matcher). Prod `.so` omits `sim_*` (verified). SIM-05/08 expiry buffers +20s (create+simOpen race; assertions unchanged). SimClock PDA deferred (!14) — not required by SIM cases. |
| **Result** | `anchor test -- --features localnet-test`: **60 passing / 0 failing** (51 P0/P1 + 9 SIM). |
| **Related** | Testers !15 · Schema !14 (docs only, not required) · D-017 · Reviewer nits follow-up |

---

## 2026-10-06T19:32:00-05:00 — Testers: localnet sim session lifecycle TDD (SIM-01…SIM-09)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (glab land) |
| **Decision** | Extend TEST_MATRIX Cluster G + failing `tests/sim_session.ts` (SIM-01…SIM-09) for **localnet-only** simulated open→trade→close→settle→redeem (D-017). Harness hooks `simOpen` / `simClose` / `simTradeOffBook` throw **TDD_RED** until Eng lands `sim_*` under `localnet-test`. Sim trade = mint + off-book Yes SPL transfer (Phoenix placeholder) — **no** Meridian matching engine. Negatives: mint after close; settle before close. Distinct from mainnet; never gate prod builds. |
| **Result** | Branch `test/sim-session-lifecycle` → MR to `main`. Engineers implement **only** to green. |
| **Related** | D-016, D-017, MR !5–!11 |

## 2026-10-06T19:30:00-05:00 — D-017 SimClock / effective_clock for localnet market open-close (Meridian Schema)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | **D-017:** Simulate mint-window open/close without wall-clock waits. No new `StrikeMarket` status for session hours — lifecycle stays `Open` → `SettledYes|SettledNo|Void`. Meridian "market open" = `status==Open && !paused && effective_now < expiry_ts`; "close" = `effective_now >= expiry_ts`. Add **SimClock** PDA seeds `["sim_clock"]` (`authority`, `unix_timestamp`, `slot`, `enabled`, `bump`); authority = `Config.authority`. Ixs `init_sim_clock` / `set_sim_clock` / `warp_sim_clock` / optional `disable_sim_clock` all `#[cfg(feature = "localnet-test")]` (same deploy-blocker pattern as mock Pyth). Time gates on mint/settle/admin_settle (+ Pyth `slot_now`) use **`effective_clock`**; prod builds use `Clock::get()` only. Preferred Anchor shape: `sim_clock: Option<Account<SimClock>>` under localnet-test. `settled_at_ts`/`settled_slot` record effective values. Event `SimClockSet`. Pause unchanged. Full proposal: [`sim-clock.md`](sim-clock.md). |
| **Result** | Schema docs updated: `docs/sim-clock.md` created; SCHEMA / accounts / flows / programs README / DECISIONS / AI_LOG aligned. Engineers implement behind `localnet-test`. |
| **Related** | D-017 · D-014 · D-016 · localnet fixtures (upsert_mock_pyth, test_drain_vault) |


---

## 2026-10-06T19:30:38-05:00 — D-017 Anytime open/close/settle simulation (V1 hard acceptance)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash + Meridian PM (lock); Grok Bot (record + TRACKER/DLV sync) |
| **Decision** | Lock **anytime market open/close/settle simulation** as a **V1 hard acceptance** requirement (**D-017**). Acceptance: E2E **create → mint → Phoenix trade → settle → redeem** in one continuous run with **no wait** for real US equity **9:30 / 4:00 ET**. Harness drives simulated **Open** and **Close**; forces **YesWins / NoWins** at known prices; real Pyth reject paths (stale / wide conf) remain testable. Prod/devnet keep real **≥4:00 PM ET** settle gate + Pyth quality; sim controls hard-gated (test feature / local validator / Config flag) and **must not weaken** production invariants. Ship documented one-command/scripted sim lifecycle in-repo alongside calendar automation. UI sim affordance **optional** for V1. Phoenix V1 spot working assumption (D-015); official land path = `glab` (D-014). |
| **Rationale** | PM + Debu need continuous demo/CI lifecycle without wall-clock equity hours; production settle/oracle invariants stay intact behind hard gates. |
| **TRACKER** | Add In Progress / Todo for sim harness, dual-mode automation, Tester E2E sim cases. `SPEC.md` still **not ready**. |
| **Related** | D-005, D-014, D-015, D-016 |

---

## 2026-10-06T17:14:55-05:00 — Testers nits on MR !11 (feature-gate fixtures + stack)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab on `eng/p1-fees`) |
| **Decision** | Approve-with-nits on !11: (1) **Stack:** MR !9 still open — merged `origin/main` into `eng/p1-fees` (`e38b57b`); branch retains `eng/p0-anchor-impl` ancestry so !11 stays clean relative to !9. **Merge-order dependency:** land !9 before !11 (or rebase after !9 merges). (2) **Deploy blockers:** `test_drain_vault` + `upsert_mock_pyth` gated `#[cfg(feature = "localnet-test")]` on modules + entrypoints; Cargo feature `localnet-test`; `idl-build` enables it for IDL typecheck only. Prod `anchor build` .so omits fixture symbols; localnet `anchor build -- --features localnet-test` includes them. `package.json` `test` / `build:localnet` / `build:prod` scripts. (3) Optional: mint/redeem `treasury` constrained `address = config.treasury`. |
| **Result** | `anchor test -- --features localnet-test`: **51 passing / 0 failing**. Prod .so verified: fixture ix names **absent**. |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/11 |
| **Related** | Testers !10 · eng P0 !9 · D-016 |

---

## 2026-10-06T17:05:00-05:00 — Eng P1 fees + edges green (MR !10 suite)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab land) |
| **Decision** | Branch `eng/p1-fees` from Testers `test/p1-fees-failing` (MR !10 @ P0 tip `6618d74`). Fee paths already fee-on-transfer-in (SCHEMA §7.3) — **M-03 / R-05 / V-06** green without P0 fee=0 weakening. Edges **S-08, X-03, M-07, M-09, M-10, V-08** green on existing program. **V-07:** landed localnet-only `test_drain_vault` fixture + harness `drainVault` to prove `InsufficientVault` (never unbacked payout). |
| **Result** | `anchor test`: **51 passing / 0 failing**. Depends on / stacks with MR !9 (P0). |
| **Related** | Testers suite MR !10 · eng P0 MR !9 · D-016 |

---


## 2026-10-06T16:55:00-05:00 — Testers P1 fees failing suite (TDD)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (glab commits API, no clone) |
| **Decision** | Land P1 TDD suite on `test/p1-fees-failing` from `eng/p0-anchor-impl` @ 6618d74 (nits verified). Core fees **M-03 / R-05 / V-06** in `tests/fees.ts`; invited edges **S-08, X-03, M-07, M-09, M-10, V-07, V-08** in `tests/p1_edges.ts`. Harness always re-applies fee bps on config reuse so P1 cannot poison P0 fee=0. **V-07** stays `TDD_RED` (no vault-drain fixture). No Rust fee logic in this MR. |
| **Result** | Branch + MR → `main` (same base as open !9). Engineers rebase after !9; implement **only** to green remaining reds. Do not weaken P0. |
| **Related** | MR !9 (P0 eng), matrix !5, D-016 |

---

## 2026-10-06T16:50:00-05:00 — Testers nits on MR !9 (R-02 / S-11 / I4 / events)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (follow-up); Grok Bot (glab push to `eng/p0-anchor-impl`) |
| **Decision** | Land Testers approve-with-nits on MR !9 before P1 fees suite: (1) **R-02** assert SettledNo → redeem(Yes) → `InvalidWinningMint` (program already enforced; test gap closed); (2) **S-11** assert Yes/No supplies unchanged across settle (SCHEMA §5.4); (3) optional I4 field snapshots on S-09/A-04; (4) optional event listeners on S-01/A-01/R-01 (`settled` / `adminSettled` / `redeemed`). |
| **Result** | `anchor test`: **41 passing / 0 failing**. No suite weakening. Ready for Testers P1 fees (M-03 / R-05 / V-06). |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/9 |

---


## 2026-10-06T16:35:00-05:00 — Eng P0 Anchor impl greens Testers suite (Meridian Engineers / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (impl); Grok Bot (orchestrate; glab land path D-014) |
| **Decision** | Land `eng/p0-anchor-impl` → `main`: full `programs/meridian` Anchor program (initialize/pause/create/mint/settle/admin_settle/redeem/set_phoenix + localnet `upsert_mock_pyth` fixture), regenerated IDL, bankrun-free harness on `solana-test-validator`, P0 case IDs from Testers MR !6 kept in `it()` titles. Includes TEST_MATRIX from MR !5. |
| **Result** | `anchor test`: **41 passing / 0 failing** (~3m). Covers all **37 P0 case IDs** (M/S/A/R/V/X + S-10 unit vectors). Phoenix = pubkey wiring only (D-004/D-015). Pyth = MockPythPrice gates (staleness 150, conf 500 bps, settle ≥ strike) per D-005. |
| **Program id** | `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (localnet placeholder; replace at deploy) |
| **Related** | MR !5 (matrix), MR !6 (failing suite), D-016 TDD |

---

## 2026-10-06T16:04:00-05:00 — TDD mandate for core program invariants (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (mandate); Grok Bot (record + enforce for Engineers/Testers) |
| **Decision** | **TDD is mandatory** for Meridian program work. Write **failing tests first**, then implement, for these core paths/invariants: **vault $1** collateralization (vault covers outstanding pairs at $1 USDC per pair), **mint**, **settle**, **redeem**, and **pause**. Do not ship implementation ahead of red tests for these. |
| **Rationale** | Locks engineer workflow to prove vault/mint/settle/redeem/pause behavior before green code; reduces silent invariant breaks on the platinum demo path. See **D-016**. |
| **Applies to** | Anchor program (`programs/meridian`), Tester plans, Reviewer gates |

---

## 2026-10-06T15:52:00-05:00 — Unblock: glab official land path; Phoenix V1 spot assumed (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (decision); Grok Bot (record + enforce) |
| **Decision** | **Cursor enterprise GitLab + MCP GitLab 404 are NOT blockers.** Official SCM land path = **`glab`** against `labs.gauntletai.com` (`GITLAB_HOST=labs.gauntletai.com`, existing `glab` auth / `GAUNTLET_GITLAB_TOKEN`). **Phoenix V1 spot** is the **working assumption** (confirmation widget skipped — do not invent a separate Debu confirm). Reword prior “blocker” language accordingly; ship via branch `docs/unblock-glab-path` + MR. |
| **Rationale** | CloudAgent/MCP gaps are tooling preferences, not program stalls. Schema/UI already land via `glab`; treat that as the sanctioned path. Spot assumption unblocks Engineers without a confirmation widget. See D-014 / D-015. |
| **Supersedes** | Framing in the 15:40:30 “Tooling blockers” entry and D-011 “blocked” wording; Phoenix V1 spot “OPEN / do not treat as confirmed” caution → working assumption (D-015). |

---

## 2026-10-06T15:48:00-05:00 — UI design slice MR (Meridian UI)

| Field | Value |
| --- | --- |
| **Actor** | Meridian UI |
| **Decision** | Open MR `ui/docs-slice` → `main` with engineer-ready UI specs under `docs/ui/` (Landing, Markets, Trade, Portfolio, History + intents/constraints + IA/routes). Append this log entry on `main` (Schema MR !1 already merged; `schema/docs-slice` gone) so AI_LOG stays single-threaded with Schema. |
| **Rationale** | Parallel UI slice; land via `glab` API on labs.gauntletai.com (same as Schema). Cursor CloudAgent/MCP unavailable — **not blockers** (see 15:52 / D-014). |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/2 |
| **Commit** | `a3c5a63d` |

Key UI locks in this slice: one Phoenix Yes/USDC book with No as display transform; four intents (Buy/Sell × Yes/No); trading UI blocks simultaneous Yes+No exposure (balances + open buys + in-flight); settlement countdown component; payoff copy "1.00 USDC if right, 0 if not". Open `TODO(schema)` / `OPEN:` tags remain in the docs.

---

## 2026-10-06T15:46:00-05:00 — Orchestration log completeness (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Append full orchestration history to this file on branch `schema/docs-slice` (MR !1); expand `DECISIONS.md` locks; do **not** open a second MR or push a parallel AI_LOG to `main` |
| **Rationale** | Schema already landed `docs/AI_LOG.md` + `DECISIONS.md` via MR !1. A parallel main commit would fork the log. Completeness + security ownership requires one append-only narrative covering repo, stack, agents, tooling notes, open assumptions, and required docs. |

---

## 2026-10-06T15:45:55-05:00 — Schema MR !1 opened (Meridian Schema / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema (commit); Grok Bot (orchestrate) |
| **Decision** | Open MR !1 `schema/docs-slice` → `main`: schema docs + companion units/accounts/flows + scaffold map + initial AI_LOG/DECISIONS |
| **Rationale** | Land schema slice for review without blocking `main` README; keep forge on Gauntlet Labs GitLab only. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/1 |
| **Commit** | `8578ea4` — `docs(schema): Anchor layouts, Phoenix/Pyth linkage, units, flows` |

---

## 2026-10-06T15:42:00-05:00 — Schema drafted locally (Meridian Schema)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | Draft on-chain schema docs locally under `/workspace/meridian-schema-docs` before API commit to GitLab: `SCHEMA.md`, `accounts.md`, `flows.md`, `units.md`, `programs/meridian/README.md` |
| **Rationale** | Local draft → `glab`/API push to `schema/docs-slice` is the sanctioned land path (CloudAgent/MCP optional; **not blockers** — see 15:52 / D-014). UI work proceeds in parallel under `/workspace/meridian-ui-specs` (to be committed as `docs/ui/`). |

---

## 2026-10-06T15:41:00-05:00 — Required docs artifacts list (Debu → Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (requirement); Grok Bot (track) |
| **Decision** | Track and eventually ship these docs artifacts in-repo (names as given): |

| Artifact |
| --- |
| `AGENTS` |
| `AI_LOG` |
| `ARCHITECTURE` |
| `CLAUDE` |
| `CONTEXT` |
| `DECISIONS` |
| `DEMO_SCRIPT` |
| `DEPLOY` |
| `DIAGRAMS` |
| `EVALS` |
| `METRICS` |
| `ORCHESTRATOR_KICKOFF` |
| `README` |
| `RED_TEAM` |
| `SPEC` |
| `TASKS` |
| `TRACKER` |

| Field | Value |
| --- | --- |
| **Rationale** | Platinum deliverable set for Peak6 / Gauntlet; AI usage log (`AI_LOG`) is mandatory. Schema MR seeds `AI_LOG` + `DECISIONS` + schema companions; remaining stubs/docs are follow-on tasks. |

---

## 2026-10-06T15:40:30-05:00 — Tooling note (historical): CloudAgent + MCP GitLab (Grok Bot) — NOT blockers (see 15:52 / D-014)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot |
| **Decision** | Prefer box-local draft + `glab` / GitLab REST with `GITLAB_HOST=labs.gauntletai.com` and `GAUNTLET_GITLAB_TOKEN`. Cursor CloudAgent (enterprise host not in Settings) and MCP GitLab (**404**) are **unavailable conveniences — not program blockers**. Official land path = `glab` (confirmed 15:52 / D-014). |
| **Rationale** | CloudAgent is not configured for `labs.gauntletai.com`; MCP GitLab returns **404**. Those gaps do **not** stall Meridian — `glab` works and is the official land path. (Superseding “blocker” framing: see 15:52 entry / D-014.) |

---

## 2026-10-06T15:40:00-05:00 — Specialist agents spawned (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Create six Meridian specialist agents; Grok Bot remains chief of staff / chief orchestrator owning **completeness** and **security** across slices. |

| Specialist | Role |
| --- | --- |
| Meridian PM | Requirements, acceptance criteria, prioritization, trade-offs |
| Meridian Schema | Anchor accounts, PDAs, events, units, automation shapes |
| Meridian UI | Next.js IA / wireframes: Landing, Markets, Trade, Portfolio, History |
| Meridian Engineers | Anchor/Rust, Next.js/TS, Node automation, Phoenix + Pyth + USDC |
| Meridian Testers | Unit/integration/frontend plans; invariant gates; lifecycle scenarios |
| Meridian Reviewers | Architecture, security (non-custodial, pause, admin delay), docs/AI_LOG, demo readiness |

| Field | Value |
| --- | --- |
| **Rationale** | Parallel Schema + UI slices need clear ownership; Engineers/Testers/Reviewers consume PM + Schema + UI outputs. Grok Bot does not replace specialists — orchestrates, enforces GitLab-only forge, and owns end-to-end completeness + security. |
| **Repo constraint (all agents)** | https://labs.gauntletai.com/debudash/peak6-meridian only — never GitHub / Origin. |

---

## 2026-10-06T15:39:30-05:00 — PM V1 acceptance bar, non-goals, parallel slices, Phoenix spot assumption (Meridian PM / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM (bar); Grok Bot (orchestration) |
| **Decision** | Adopt V1 acceptance bar + non-goals; run **Schema** and **UI** as parallel slices; treat **Phoenix V1 spot** as the working assumption (confirmation widget **skipped** — later confirmed as D-015 / 15:52). |

### V1 acceptance bar (minimum)
- Non-custodial dApp: mint Yes/No pairs vs USDC, trade on Phoenix Yes/USDC book, settle via Pyth ~4:00 PM ET, redeem winners 1:1 USDC
- MAG7 0DTE binary markets; Yes + No payout identity = $1 USDC; vault covers outstanding pairs
- On-chain: Config, Create Strike Market, Mint, Settle, Admin Settle (delayed), Redeem, Pause/Unpause
- Frontend surfaces: Landing, Markets, Trade, Portfolio, History
- Stack: Solana + Anchor, Phoenix (integrate), Pyth, USDC; Next.js/TS frontend; Node/TS automation
- Core submission: **never mainnet**
- Docs/demo: source + tech docs + demo + deploy guide + test results + AI usage log

### Non-goals (V1)
- Custom matching engine / home-grown CLOB
- Multi-collateral
- Inventing regulatory/compliance claims
- On-chain code in the schema docs slice (scaffold map only)
- Phoenix spot confirmation widget / invented Debu confirmation of spot wiring

### Working assumption — Phoenix V1 spot (locked as assumption in D-015)
- **Assumption:** V1 uses Phoenix **spot** markets (Yes base / USDC quote) as Schema defaulted.
- **Status:** **WORKING ASSUMPTION** (Debu / Grok Bot, 15:52) — confirmation widget **skipped**; do not invent a separate confirm. Schema/UI/Engineers proceed on spot. Revisit only if Debu explicitly changes product direction.

| Field | Value |
| --- | --- |
| **Rationale** | Unblocks parallel Schema/UI without inventing product confirmation; keeps risk visible in AI_LOG. |

---

## 2026-10-06 — Schema slice defaults (Meridian Schema)

**Agent:** Meridian Schema  
**Repo path:** `docs/SCHEMA.md` (+ companions)  
**Status:** Proposed on branch `schema/docs-slice` (land via MR !1)

### Locked defaults
| Decision | Choice | Rationale |
| --- | --- | --- |
| Price / strike / settlement / Yes price scale | `PRICE_SCALE = 1_000_000` (1e6) | Align with USDC + outcome mint decimals (6) |
| Phoenix base mint | Yes outcome mint | Single Yes/USDC book; UI maps No via inverse |
| Phoenix quote mint | Collateral (USDC) | Standard CLOB quote |
| Custom matching | **Do not build** — integrate Phoenix only | Stack lock |
| Pyth max staleness | 150 slots | Settle gate |
| Pyth max confidence ratio | 500 bps (5%) | Reject noisy prints |
| Yes wins if | `settlement_price_e6 >= strike_price_e6` | Inclusive touch |
| Binary payout | $1 USDC per winning token | Vault covers outstanding pairs |
| Protocol fees | Fields present; default **0 bps** | Can enable later without layout change |
| Pause behavior | Blocks mint/create; settle+redeem still allowed | Protect LPs / resolution |
| Forge | Gauntlet Labs GitLab only (`labs.gauntletai.com/debudash/peak6-meridian`) | No GitHub/Origin |

### Accounts / instructions / events (summary)
- Accounts: `Config`, `StrikeMarket`, vault authority PDA, Yes mint, No mint
- Instructions: create market, mint, settle, admin_settle, redeem, pause, set_phoenix_market
- Events: MarketCreated, Minted, Settled, Redeemed (+ config/pause updates as needed)

### Open questions (see SCHEMA.md §8)
1. Phoenix base side (Yes vs No) — default Yes pending PM/UI confirm
2. Exact MAG7 Pyth feed ids / price accounts
3. `>=` vs `>` on strike
4. `equity_symbol` `[u8;8]` vs AssetRegistry PDA
5. StrikeMarket PDA seeds `(symbol, expiry, strike)` vs `market_id` only
6. Whether v1 includes `burn_losing`
7. Fee policy beyond 0 bps defaults
8. Settle-window policy vs automation retries
9. Multi-collateral — out of scope for v1
10. **Phoenix V1 spot** — **working assumption** (D-015); widget skipped; not a blocker (see 15:52)

### Non-goals this slice
- No Anchor program source yet (scaffold map only under `programs/meridian/`)
- No custom CLOB
- No frontend work (parallel track)

---

## 2026-10-06T15:33:45-05:00 — Stack lock + GitLab-only mandate (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (lock); Grok Bot (enforce for all agents) |
| **Decision** | **Stack:** Solana + Anchor (Rust); **CLOB:** Phoenix (integrate existing — do not build matching); **Oracle:** Pyth equity closes. **Forge:** Gauntlet Labs GitLab **ONLY** — `https://labs.gauntletai.com/debudash/peak6-meridian`. Never GitHub, never Cursor Origin remotes for Meridian source of truth. |
| **Rationale** | Matches Peak6 / Gauntlet private platinum brief; Phoenix + Pyth are preferred integrations; multi-forge would desync agents and leak private work. |

---

## 2026-10-06T15:33:33-05:00 — Private repo created (Debu)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash |
| **Decision** | Create private project `debudash/peak6-meridian` on `labs.gauntletai.com` (default branch `main`, initial README only). |
| **Rationale** | Single private forge for Meridian (Peak6) agent + human collaboration. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian |
| **Commit** | `4e449f8` — `Initial commit` |

---

## 2026-10-06T21:32:00-05:00 — SPEC freeze includes UI wireframes on !20 (Meridian PM)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM |
| **Decision** | Debu: UI wireframes must land **in SPEC freeze MR !20** (branch `docs/d012-spec-freeze`), **not** a separate MR. SPEC §3.10 + §8 updated; `docs/ui/wireframes/` slot + README for Meridian UI pushes; TRACKER In Progress updated. |
| **Rationale** | Single freeze package: product SPEC + visual contract for five V1 pages before Debu lock ping. |
| **Related** | D-012 · MR !20 · `docs/ui/` |

