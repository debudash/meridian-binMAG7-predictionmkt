# Meridian decisions index

Short index of **locked** durable product/tech/orchestration decisions only.
Narrative, open assumptions, tooling notes, and chronology live in [`AI_LOG.md`](AI_LOG.md).
Do not duplicate long rationale here — link the log.

| ID | Topic | Decision | Owner | Date (America/Chicago) |
| --- | --- | --- | --- | --- |
| D-001 | SCM | Source of truth = Gauntlet Labs GitLab `debudash/peak6-meridian` (private). **Never** GitHub / Origin for Meridian. | Debu / Grok Bot | 2026-10-06 |
| D-002 | Stack | Solana + Anchor; Phoenix CLOB (**integrate**, do not build matching); Pyth equity closes; USDC collateral | Debu (lock) / Grok Bot (enforce) | 2026-10-06 |
| D-003 | Units | `PRICE_SCALE = 1e6` for strike / settlement / Yes price | Meridian Schema | 2026-10-06 |
| D-004 | Phoenix wiring | Base = Yes mint; quote = USDC (single book; UI maps No) | Meridian Schema | 2026-10-06 |
| D-005 | Settle gates | Max staleness **150 slots**; max conf ratio **500 bps**; Yes if `settle ≥ strike` | Meridian Schema | 2026-10-06 |
| D-006 | Payout | $1 USDC binary; vault covers pairs minted; fees default **0 bps** | Meridian Schema | 2026-10-06 |
| D-007 | Repo | Private project `peak6-meridian` created on `labs.gauntletai.com` | Debu | 2026-10-06 |
| D-008 | Orchestration | Grok Bot = chief orchestrator / chief of staff; owns **completeness** + **security** | Debu / Grok Bot | 2026-10-06 |
| D-009 | Agents | Specialists: Meridian PM, Schema, UI, Engineers, Testers, Reviewers | Grok Bot | 2026-10-06 |
| D-010 | Delivery slices | Schema and UI proceed **in parallel**; Engineers consume both | Meridian PM / Grok Bot | 2026-10-06 |
| D-011 | Tooling (historical) | ~~CloudAgent/MCP framed as blockers~~ — **OBSOLETE**; superseded by **D-014**. CloudAgent/MCP 404 remain unavailable conveniences only. | Grok Bot | 2026-10-06 |
| D-012 | Docs set | Required artifacts: AGENTS, AI_LOG, ARCHITECTURE, CLAUDE, CONTEXT, DECISIONS, DEMO_SCRIPT, DEPLOY, DIAGRAMS, EVALS, METRICS, ORCHESTRATOR_KICKOFF, README, RED_TEAM, SPEC, TASKS, TRACKER | Debu | 2026-10-06 |
| D-013 | Schema land path | Schema slice ships via MR !1 on `schema/docs-slice` (not a second main-only AI_LOG) | Meridian Schema / Grok Bot | 2026-10-06 |
| D-014 | SCM land path | **Official land path = `glab`** against `labs.gauntletai.com` (`GITLAB_HOST`, existing auth / `GAUNTLET_GITLAB_TOKEN`). Cursor enterprise GitLab + MCP GitLab **404 are NOT blockers**. | Debu / Grok Bot | 2026-10-06 |
| D-015 | Phoenix V1 | **Phoenix V1 spot** is the **working assumption** (Yes/USDC book); confirmation widget skipped — do not invent confirm. | Debu / Grok Bot | 2026-10-06 |
| D-016 | TDD | **TDD mandatory:** failing tests first for **vault $1**, **mint**, **settle**, **redeem**, **pause**; then implement. | Debu / Grok Bot | 2026-10-06 |

## Explicitly not locked (see AI_LOG)

| Topic | Status |
| --- | --- |
| Phoenix **V1 spot** product confirmation | **OBSOLETE as OPEN** — superseded by **D-015**: working assumption (widget skipped) |
| Phoenix base Yes vs No | Default Yes; still listed open in SCHEMA §8 |
| Exact MAG7 Pyth feed ids | Placeholder until pinned |
| Strike `>=` vs `>` | Default `>=`; product may revisit |

## Obsolete / superseded notes

| Ref | Note |
| --- | --- |
| D-011 | Prior “CloudAgent/MCP blocked” wording — **obsolete**; see D-014 |
| AI_LOG 15:40:30 | Historical tooling note; reworded — not a program blocker |
| Phoenix V1 spot “OPEN” | **Obsolete**; D-015 working assumption |
