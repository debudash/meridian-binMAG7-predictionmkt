# Meridian tracker

Kanban for Peak6 Meridian work. Columns: **Done** / **In Progress** / **Todo** only.
No Blocked column — Cursor enterprise GitLab + MCP 404 are not blockers; land via `glab` (D-014). Phoenix V1 spot is the working assumption (D-015).

## Done

- [x] Private repo `debudash/peak6-meridian` on `labs.gauntletai.com` (D-007)
- [x] Stack + GitLab-only forge lock (D-001, D-002)
- [x] Schema docs slice landed (MR !1): `SCHEMA.md`, units/accounts/flows, program scaffold map
- [x] AI_LOG + DECISIONS seeded; orchestration history appended
- [x] Specialist agents defined (D-009); Schema ∥ UI slices (D-010)
- [x] Official land path = `glab` (D-014); Phoenix V1 spot working assumption (D-015)
- [x] UI design slice MR opened (`ui/docs-slice`, MR !2)

## In Progress

- [ ] UI docs merge review (MR !2 → `main`)
- [ ] Docs unblock MR (`docs/unblock-glab-path`) — this change set
- [ ] Remaining required docs stubs from D-012 (AGENTS, ARCHITECTURE, CLAUDE, CONTEXT, …)

## Todo

- [ ] `docs/AGENTS.md` / agent roster
- [ ] `docs/ARCHITECTURE.md`
- [ ] `docs/SPEC.md` / PRD alignment
- [ ] `docs/TASKS.md` breakdown for Engineers
- [ ] `docs/DEMO_SCRIPT.md`, `docs/DEPLOY.md`, `docs/EVALS.md`, `docs/METRICS.md`
- [ ] `docs/RED_TEAM.md`, `docs/DIAGRAMS.md`, `docs/CONTEXT.md`, `docs/CLAUDE.md`
- [ ] `docs/ORCHESTRATOR_KICKOFF.md`
- [ ] Anchor program implementation (consume Schema)
- [ ] Next.js UI implementation (consume UI specs)
- [ ] Node automation (Pyth settle path)
- [ ] Tester plans + invariant gates
- [ ] Reviewer pass (security, non-custodial, pause, admin delay, demo readiness)
