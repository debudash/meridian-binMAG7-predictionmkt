# Meridian tracker

Kanban for Peak6 Meridian work. Columns: **Done** / **In Progress** / **Todo** only.
No Blocked column — land via `glab` (D-014). Phoenix V1 spot is the working assumption (D-015). **TDD mandatory** for vault $1 / mint / settle / redeem / pause (D-016). **Anytime open/close/settle simulation** is a V1 hard acceptance requirement (D-017). **D-018** locks prod `merge_pair`, A-05 Policy A, and X-07 Settling retire.
**Prod app/automation host:** Railway (staging→prod per [`DEPLOY.md`](DEPLOY.md)) — deploy deferred locally; Debu browsing fixtures @ localhost:3000.

_Last refreshed: 2026-10-07 09:55 CT (eng/dlv065-sim-clock green on tip `ef1a61a`; Reviewer DLV-037 conditional pass; !40 docs polish)._

## Done

- [x] Private repo `debudash/peak6-meridian` on `labs.gauntletai.com` (D-007)
- [x] Stack + GitLab-only forge lock (D-001, D-002)
- [x] Schema docs slice landed (MR !1): `SCHEMA.md`, units/accounts/flows, program scaffold map
- [x] AI_LOG + DECISIONS seeded; orchestration history appended
- [x] Specialist agents defined (D-009); Schema ∥ UI slices (D-010)
- [x] Official land path = `glab` (D-014); Phoenix V1 spot working assumption (D-015)
- [x] UI design slice landed (MR !2, `ui/docs-slice`)
- [x] Docs unblock: glab land path + Phoenix spot assumed (MR !3, `docs/unblock-glab-path`)
- [x] TDD mandate locked (D-016) via MR !4 (`docs/tdd-mandate`): failing tests first for vault $1, mint, settle, redeem, pause
- [x] TRACKER synced to live MR state (MR !7) and Peak6 PRD deliverables added (MR !8)
- [x] Tester plan: `docs/TEST_MATRIX.md` landed (MR !5) — mint/settle/redeem + $1 vault
- [x] Failing P0 TDD suite landed (MR !6; `test/failing-lifecycle-invariants`): 37 P0 cases — mint/settle/redeem/$1 vault/pause
- [x] Anchor P0 impl landed (MR !9; `eng/p0-anchor-impl`): **41 passing / 0 failing**, all 37 P0 case IDs green
- [x] Tester P1 fees + edges failing suite landed (MR !10; `test/p1-fees-failing`): M-03/R-05/V-06 + S-08, X-03, M-07, M-09, M-10, V-07, V-08
- [x] Eng P1 fees + edges green landed (MR !11; `eng/p1-fees`): **51 passing / 0 failing**; V-07 via localnet-only `test_drain_vault`; fixtures feature-gated
- [x] Anytime open/close/settle simulation locked as V1 hard acceptance (D-017) (MR !13)
- [x] Schema SimClock + `effective_clock` docs landed (MR !14; `schema/sim-clock`)
- [x] Tester Cluster G SIM-01…09 suite landed (MR !15; `test/sim-session-lifecycle`)
- [x] Eng SIM green: `sim_open_session` / `sim_close_session` + `trading_open` under `localnet-test` (MR !16; `eng/sim-session`) — **60 passing / 0 failing** (localnet)
- [x] Reviewer nits: real Pyth prod path, fee caps, prod IDL + fixture assert (MR !17; `eng/reviewer-nits-pyth-idl`) — `upsert_mock_pyth` / `test_drain_vault` / `sim_*` excluded from prod builds
- [x] GitLab CI + `docs/DEPLOY.md` ladder (MR !18; `eng/ci-deploy`) — Railway staging→prod app+automation; runners may be absent on labs host
- [x] TRACKER + AI_LOG post !14–!18 land (MR !19; `docs/tracker-post-14-18`)
- [x] D-012 docs stubs + UI wireframes + **SPEC locked** (MR !20; `docs/d012-spec-freeze`): `SPEC.md` **Done/locked**, `AGENTS.md`, `ARCHITECTURE.md`, `TASKS.md`, `DEMO_SCRIPT.md`, `EVALS.md`, `METRICS.md`, `RED_TEAM.md`, `DIAGRAMS.md`, `CONTEXT.md`, `CLAUDE.md`, `ORCHESTRATOR_KICKOFF.md`, `docs/ui/wireframes/` — root README Docs map updated
- [x] Node automation dual-mode landed (MR !21; `eng/node-automation`) — calendar ET worker + localnet-only sim lifecycle; `docs/SIM_LIFECYCLE.md` one-command path
- [x] Next.js UI V1 scaffold landed (MR !22; `eng/nextjs-ui`) — `apps/web` App Router + prod IDL mint/redeem + intent tests
- [x] UI nits post-!22 landed (MR !23; `eng/ui-nits-post-22`) — markets/trade/portfolio polish
- [x] SECURITY/Railway remediation landed (MR !24; `eng/sec-keypair-railway`) — rotated program id `9Rb7nx…`; tip-deleted committed keypair; Railway IDL/health. **History scrub skipped** (Debu declined filter-repo/BFG force-push)
- [x] Testers: suite/fixtures/docs confirm new program id + gitignored keypair (MR !25; `test/program-id-rotate`) — current `9Rb7nx…`; revoked `GwTvo…`
- [x] TRACKER/AI_LOG post-!20 SPEC lock confirm (MR !26; `docs/tracker-spec-lock`)
- [x] Eng: Phoenix place + Buy No composition + indexer (MR !28; `eng/phoenix-place-indexer`) — SDK place; Buy No = mint + ask Yes @ `1−p_no`; indexer HTTP→GPA→fixtures
- [x] Schema D-018: prod `merge_pair` + Settling retire + admin_settle Policy A (MR !29; `schema/merge-pair`)
- [x] Tester merge_pair red suite MP-01…MP-08 (MR !30; `test/merge-pair-failing`)
- [x] Eng: prod `merge_pair` greens MP-01…MP-08 (MR !31; `eng/merge-pair`; D-018) — prod IDL includes `merge_pair`
- [x] Eng: P2 A-05/X-07/INV gates (MR !32; `eng/p2-invariant-gates`) — **74/74** localnet; Policy A + Settling retired
- [x] Eng: client Sell No `buildMergeIx` + size unify (MR !33; `eng/sell-no-merge-size`) — Reviewer Highs; resting merge-on-fill still phased
- [x] Eng: harden X-03/SIM-08 localnet timing flakes (MR !34; `eng/flake-timing-x03-sim08`) — harness-only `EXPIRY_MINT_SLACK_SECS=30` + Clock sysvar poll; **74/74** localnet (~28m)

- [x] Peak6 PRD: test results artifact DLV-039 (MR !36; `docs/TEST_RESULTS.md`) — 74/74 cite tip `65c1ddf`/`92d414e` (!34 flake harden)
- [x] Schema D-019: pin MAG7 Pyth feed ids + SCHEMA §8 V1 inventory (MR !37; DLV-041; `schema/mag7-pyth-feeds`)

- [x] Eng: Phoenix Buy/Sell No **on-book sim E2E** DLV-064 (MR !38; `eng/dlv064-phoenix-onbook-e2e`) — `simTradeOnBook` + PHX-01…06; off-book demoted; residual Phoenix.so market create in `docs/phoenix-onbook-sim.md`; TRACKER cite MR !39

- [x] Eng SimClock PDA `init`/`set`/`warp`/`disable` (MR pending; `eng/dlv065-sim-clock`) — `effective_clock` on mint/settle/admin_settle; SC-01…03; suite **87/87** localnet (84 prior + 3 SC fixed; SC-IDL); localnet-test only

## In Progress

- [ ] Reviewer continuous / demo readiness (DLV-037) — docs polish landed (MR !40); remaining: Peak6 PRD demo **video** (DLV-038); fixtures/localnet walkthrough **conditional pass** @ `bcf5d23` (Reviewers)

## Todo

- [ ] UI sim affordance (optional for V1) (D-017)
- [ ] Peak6 PRD: demo video (distinct from `DEMO_SCRIPT.md`)
