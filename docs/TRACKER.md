# Meridian tracker

Kanban for Peak6 Meridian work. Columns: **Done** / **In Progress** / **Todo** only.
No Blocked column — land via `glab` (D-014). Phoenix V1 spot is the working assumption (D-015). **TDD mandatory** for vault $1 / mint / settle / redeem / pause (D-016). **Anytime open/close/settle simulation** is a V1 hard acceptance requirement (D-017).

_Last refreshed: 2026-10-06 ~23:45 CT (sec keypair rotate + Railway IDL/health on `eng/sec-keypair-railway`)._

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
- [x] GitLab CI + `docs/DEPLOY.md` ladder (MR !18; `eng/ci-deploy`) — runners may be absent on labs host; merge proceeded anyway
- [x] Node automation dual-mode landed (MR !21; `eng/node-automation`) — calendar ET worker + localnet-only sim lifecycle; Phoenix market create stubbed
- [x] Next.js UI V1 scaffold landed (MR !22; `eng/nextjs-ui`) — `apps/web` App Router + prod IDL mint/redeem + intent tests; Phoenix placement stubbed

## In Progress

- [ ] SECURITY/Railway remediation (`eng/sec-keypair-railway`): remove committed program keypair + rotate program id; bake automation IDL; web/automation Railway health — landing ASAP (Debu don't-wait)
- [ ] `docs/SPEC.md` **not ready** (not on main) — Debu waiting to be notified when ready
- [ ] Reviewer continuous / demo readiness (beyond !17 nits) — security + demo walkthrough still owed
- [ ] Phoenix Buy/Sell No composition + real on-book trade in sim E2E (sim trade today = off-book Yes SPL placeholder)

## Todo

- [ ] Remaining D-012 docs stubs: `AGENTS.md`, `ARCHITECTURE.md`, `TASKS.md`, `DEMO_SCRIPT.md`, `EVALS.md`, `METRICS.md`, `RED_TEAM.md`, `DIAGRAMS.md`, `CONTEXT.md`, `CLAUDE.md`, `ORCHESTRATOR_KICKOFF.md` (`DEPLOY.md` Done via !18)
- [ ] Eng SimClock PDA impl (`init`/`set`/`warp` behind `localnet-test`) per `docs/sim-clock.md` (docs landed !14; not required by SIM-01…09)
- [ ] UI sim affordance (optional for V1) (D-017)
- [ ] Tester P2 cases + invariant gates after P0/P1 land on main (D-016)
- [ ] Peak6 PRD: demo video (distinct from `DEMO_SCRIPT.md`)
- [ ] Peak6 PRD: test results artifact (after suite execution on main)
