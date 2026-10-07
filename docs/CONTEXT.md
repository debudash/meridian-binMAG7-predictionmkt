# Meridian context (agents joining mid-stream)

**One-pager.** Read this, then SPEC + DECISIONS + TRACKER.

## What Meridian is

Non-custodial **binary Yes/No** markets on **MAG7** daily closes; **$1 USDC** invariant; trade on **Phoenix** (integrate, don’t build matching); settle with **Pyth**; stack = Anchor + Node automation + Next.js; host app/automation on **Railway**.

## Hard locks

| Ref | Meaning |
| --- | --- |
| D-001 / D-014 | Gauntlet GitLab only; land with **`glab`** |
| D-015 | Phoenix **V1 spot** working assumption |
| D-016 | TDD: failing tests first for vault $1 / mint / settle / redeem / pause |
| D-017 | **Anytime sim** is V1 hard acceptance (no wait for 9:30/4:00 ET) |
| — | No regulatory/compliance claims |
| — | Tracker columns: Done / In Progress / Todo only |

## Where things live

| Need | Doc |
| --- | --- |
| Freeze contract | [`SPEC.md`](SPEC.md) |
| Locked decisions | [`DECISIONS.md`](DECISIONS.md) |
| Kanban | [`TRACKER.md`](TRACKER.md) |
| Accounts / ixs | [`SCHEMA.md`](SCHEMA.md) |
| Tests | [`TEST_MATRIX.md`](TEST_MATRIX.md) |
| Deploy / Railway | [`DEPLOY.md`](DEPLOY.md) |
| UI specs | [`ui/`](ui/) |
| Narrative history | [`AI_LOG.md`](AI_LOG.md) |

## Current engineering snapshot (refresh via TRACKER)

- Localnet: P0 + P1 + SIM green (**60/60** at SIM eng land).
- Prod path: real Pyth decoder, fee caps, prod IDL assert, CI + DEPLOY ladder on main.
- Still open: Next.js impl, calendar automation, Phoenix on-book No composition, Debu SPEC lock ping.

## How to land work

```bash
export GITLAB_HOST=labs.gauntletai.com
# branch off main → commit → push → glab mr create
```

Do not wait on Cursor CloudAgent/MCP. Prefer editing existing docs over wholesale rewrites of SCHEMA/UI.
