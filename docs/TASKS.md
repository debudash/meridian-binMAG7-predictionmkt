# Meridian tasks checklist

Derived from [`TRACKER.md`](TRACKER.md). Owners align with [`AGENTS.md`](AGENTS.md).  
Statuses: **Todo** / **In Progress** / **Done** only (no Blocked).

## Done (selected)

- [x] Schema docs + UI specs + DECISIONS D-001…D-017 (various MRs)
- [x] P0/P1 TDD suites + eng green (MR !5–!11) — 51 cases
- [x] D-017 + SimClock docs + SIM suite + eng green (MR !13–!16) — 60/60 localnet
- [x] Reviewer nits + CI + DEPLOY (MR !17–!18); TRACKER sync (!19)
- [x] `docs/SPEC.md` freeze candidate + remaining D-012 stubs (this slice)

## In Progress

- [ ] **Testers:** P2 cases + invariant gates suite MR (`test/p2-invariant-gates`) — A-05 / R-08 / X-07 + INV-* — Owner: Meridian Testers
- [x] **PM:** Debu SPEC lock — Done on tip (!20) — Owner: Meridian PM / Debu
- [ ] **Reviewers:** Continuous security + demo readiness beyond !17 — Owner: Meridian Reviewers
- [ ] **Engineers:** Phoenix Buy/Sell No composition + real on-book trade in sim E2E — Owner: Meridian Engineers

## Todo

- [ ] Next.js UI implementation (five pages) — UI specs → Engineers
- [ ] Node automation: morning strike creation (~8:00 ET) + Pyth settle retries — Engineers
- [ ] Dual-mode automation: calendar path **and** hard-gated sim path (D-017) — Engineers
- [ ] Documented one-command/scripted sim lifecycle in-repo — Engineers / PM
- [ ] Eng SimClock PDA impl (optional vs SIM-01…09) — Engineers
- [ ] UI sim affordance (optional V1) — UI / Engineers
- [ ] Peak6 PRD: demo video (distinct from DEMO_SCRIPT) — PM / Debu
- [ ] Peak6 PRD: test results artifact from main — Testers / PM

## Notes

- Phoenix V1 spot = working assumption (D-015).
- Railway = prod app/automation target ([`DEPLOY.md`](DEPLOY.md)).
- Land everything with `glab` on Gauntlet GitLab (D-014).
