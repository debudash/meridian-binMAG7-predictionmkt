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
- [x] TDD mandate locked (D-016): failing tests first for vault $1, mint, settle, redeem, pause

## In Progress

- [ ] Docs TDD mandate MR (`docs/tdd-mandate`) — this change set
- [ ] Remaining required docs stubs from D-012 (AGENTS, ARCHITECTURE, CLAUDE, CONTEXT, …)

## Todo

- [ ] `docs/AGENTS.md` / agent roster
- [ ] `docs/ARCHITECTURE.md`
- [ ] `docs/SPEC.md` / PRD alignment
- [ ] `docs/TASKS.md` breakdown for Engineers (include TDD order per D-016)
- [ ] `docs/DEMO_SCRIPT.md`, `docs/DEPLOY.md`, `docs/EVALS.md`, `docs/METRICS.md`
- [ ] `docs/RED_TEAM.md`, `docs/DIAGRAMS.md`, `docs/CONTEXT.md`, `docs/CLAUDE.md`
- [ ] `docs/ORCHESTRATOR_KICKOFF.md`
- [ ] Anchor program: **failing tests first** (vault $1, mint, settle, redeem, pause) then implement (D-016)
- [ ] Next.js UI implementation (consume UI specs)
- [ ] Node automation (Pyth settle path)
- [ ] Tester plans + invariant gates (align with D-016 red→green)
- [ ] Reviewer pass (security, non-custodial, pause, admin delay, demo readiness, TDD evidence)
