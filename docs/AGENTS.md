# Meridian agents roster

**Forge:** Gauntlet Labs GitLab only — land with `GITLAB_HOST=labs.gauntletai.com glab` (D-014).  
**Orchestrator:** Grok Bot (D-008) — owns **completeness** + **security**.

| Agent | Owns | Consumes | Does not |
| --- | --- | --- | --- |
| **Grok Bot** | Slice kickoff, MR land path, completeness + security gates, TRACKER hygiene | Debu lock pings, specialist MRs | Invent regulatory claims; invent Phoenix confirm beyond D-015 |
| **Meridian PM** | SPEC, TRACKER, TASKS, DEMO_SCRIPT, product acceptance wording | DECISIONS, SCHEMA, TEST_MATRIX | Rewrite SCHEMA/UI wholesale; lock DECISIONS without Debu |
| **Meridian Schema** | SCHEMA, accounts, flows, units, sim-clock | DECISIONS D-003…D-006, D-017 | Product scope expansion; UI copy |
| **Meridian UI** | `docs/ui/*` specs (five pages + intents + IA) | Product summary, Phoenix mapping (D-004/D-015) | On-chain instruction design |
| **Meridian Engineers** | Anchor program, Phoenix SDK wiring, Node automation, Next.js impl, CI/DEPLOY | SCHEMA + UI specs + failing tests | Weaken prod sim gates; land without glab |
| **Meridian Testers** | TEST_MATRIX, failing TDD suites first (D-016), SIM cluster | SCHEMA invariants | Product Rust in the same MR as red tests |
| **Meridian Reviewers** | Security checklist, demo readiness, deploy gates | RED_TEAM, DEPLOY, SPEC acceptance | Silent scope creep |

## Land path (all agents)

```bash
export GITLAB_HOST=labs.gauntletai.com
glab auth status   # expect labs.gauntletai.com as debudash
# branch → commit → push → glab mr create → (Debu/Grok merge when green)
```

Never open Meridian work against GitHub/Origin. Cursor CloudAgent/MCP GitLab 404s are **not** blockers (D-014).

## Parallelism (D-010)

Schema ∥ UI proceed in parallel. Engineers consume both. Testers lead with failing tests for vault $1 / mint / settle / redeem / pause (D-016). Anytime sim is V1 hard acceptance (D-017).
