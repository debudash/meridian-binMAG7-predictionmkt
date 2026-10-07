# Orchestrator kickoff (Grok Bot)

How Grok Bot kicks Meridian slices. Ownership: **completeness** + **security** (D-008).

## Before kicking a slice

1. Read [`TRACKER.md`](TRACKER.md) In Progress / Todo and [`SPEC.md`](SPEC.md) acceptance.
2. Confirm land path = `glab` on Gauntlet GitLab (D-014) — do not wait on CloudAgent/MCP.
3. Name owner from [`AGENTS.md`](AGENTS.md); keep Schema ∥ UI parallelism (D-010) when both empty.
4. For eng/test: enforce D-016 (red tests first) and D-017 (sim gates not weakened).

## Kick pattern

| Step | Action |
| --- | --- |
| 1 | State goal, branch name, acceptance, non-goals |
| 2 | Point to SPEC / SCHEMA / TEST_MATRIX rows that must stay green |
| 3 | Require MR via `glab mr create` against `main` |
| 4 | Require AI_LOG append + TRACKER update on land |
| 5 | Reviewers for security-sensitive or deploy-ladder moves |

## Completeness checklist (orchestrator)

- [ ] Acceptance criteria testable and cited
- [ ] Docs companions updated (not orphan SPEC claims)
- [ ] No invented regulatory language
- [ ] Phoenix assumption remains D-015 unless Debu revisits
- [ ] Sim / fixtures feature-gated; prod assert path mentioned when relevant

## Security checklist (orchestrator)

- [ ] No prod vault drain path
- [ ] No `localnet-test` on public clusters
- [ ] Secrets not in git; Railway env via secrets
- [ ] RED_TEAM items addressed or TRACKER’d as In Progress/Todo

## After land

Merge only with Debu/Grok authorization when required; prefer open MR + report URL for docs slices. Refresh TRACKER; append AI_LOG with America/Chicago timestamp.
