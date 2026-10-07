# Meridian tracker

Kanban for Peak6 Meridian work. Columns: **Done** / **In Progress** / **Todo** only.
No Blocked column — land via `glab` (D-014). Phoenix V1 spot is the working assumption (D-015). **TDD mandatory** for vault $1 / mint / settle / redeem / pause (D-016). **Anytime open/close/settle simulation** is a V1 hard acceptance requirement (D-017).

_Last refreshed: 2026-10-06 19:32 CT (Testers SIM suite TDD_RED on `test/sim-session-lifecycle`)._

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
- [x] Anytime open/close/settle simulation locked as V1 hard acceptance (D-017)

## In Progress

- [ ] Testers localnet sim session TDD suite (SIM-01…SIM-09) landing on `test/sim-session-lifecycle` → MR to main (D-017)
- [ ] `docs/SPEC.md` **not ready** (not on main) — Debu waiting to be notified when ready
- [ ] Reviewer pass (security, non-custodial, pause, admin delay, demo readiness, TDD evidence) — **must confirm** localnet-only fixtures `upsert_mock_pyth` / `test_drain_vault` stay excluded from mainnet builds
- [ ] Sim harness (Eng): land `sim_open_session` / `sim_close_session` + `trading_open` under `localnet-test` to green Testers SIM-01…SIM-09 (D-017) — suite on `test/sim-session-lifecycle`

## Todo

- [ ] Remaining D-012 docs stubs: `AGENTS.md`, `ARCHITECTURE.md`, `TASKS.md`, `DEMO_SCRIPT.md`, `DEPLOY.md`, `EVALS.md`, `METRICS.md`, `RED_TEAM.md`, `DIAGRAMS.md`, `CONTEXT.md`, `CLAUDE.md`, `ORCHESTRATOR_KICKOFF.md`
- [ ] Phoenix integration: Buy/Sell No composition (mint+sell Yes / buy Yes+merge) — SDK vs Meridian-wrapped ix still open
- [ ] Next.js UI implementation (consume UI specs)
- [ ] Node automation: morning strike creation (~8:00 ET) + Pyth settle retries
- [ ] Dual-mode automation: calendar path (real ≥4:00 PM ET + Pyth quality) **and** hard-gated sim path (test feature / local validator / Config flag) — must not weaken prod invariants (D-017)
- [ ] Documented one-command/scripted sim lifecycle in-repo (alongside calendar automation) (D-017)
- [x] Tester E2E sim cases **TDD_RED** landed: Cluster G SIM-01…SIM-09 in `tests/sim_session.ts` + TEST_MATRIX (D-017) — Eng implements to green; Pyth reject paths remain in settle suite
- [ ] UI sim affordance (optional for V1) (D-017)
- [ ] Tester P2 cases + invariant gates after P0/P1 land on main (D-016)
- [ ] Peak6 PRD: demo video (distinct from `DEMO_SCRIPT.md`)
- [ ] Peak6 PRD: test results artifact (after suite execution on main)
