# Meridian tracker

Kanban for Peak6 Meridian work. Columns: **Done** / **In Progress** / **Todo** only.
No Blocked column — Cursor enterprise GitLab + MCP 404 are not blockers; land via `glab` (D-014). Phoenix V1 spot is the working assumption (D-015). **TDD mandatory** for vault $1 / mint / settle / redeem / pause (D-016).

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

## In Progress

- [ ] Tester plan: `docs/TEST_MATRIX.md` (MR !5, OPEN) — mint/settle/redeem + $1 vault
- [ ] Failing TDD suite (MR !6, OPEN; `test/failing-lifecycle-invariants`): **37 P0 red** — mint/settle/redeem/$1 vault/pause
- [ ] Engineers implementing Anchor P0 **only to green** Testers suite (D-016)
- [ ] `docs/SPEC.md` **not ready** — Debu waiting to be notified when ready

## Todo

- [ ] Remaining D-012 docs stubs: `AGENTS.md`, `ARCHITECTURE.md`, `TASKS.md`, `DEMO_SCRIPT.md`, `DEPLOY.md`, `EVALS.md`, `METRICS.md`, `RED_TEAM.md`, `DIAGRAMS.md`, `CONTEXT.md`, `CLAUDE.md`, `ORCHESTRATOR_KICKOFF.md`
- [ ] Anchor program green against Testers' failing suite (vault $1, mint, settle, redeem, pause) (D-016)
- [ ] Next.js UI implementation (consume UI specs)
- [ ] Node automation (Pyth settle path)
- [ ] Tester P1/P2 cases + invariant gates after P0 suite greens (D-016)
- [ ] Reviewer pass (security, non-custodial, pause, admin delay, demo readiness, TDD evidence)
