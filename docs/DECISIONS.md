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
| D-017 | Anytime sim (V1) | **Anytime open/close/settle simulation is a V1 hard acceptance requirement.** E2E create→mint→Phoenix trade→settle→redeem must run in one continuous harness with **no wait** for real US equity 9:30/4:00 ET. Harness drives simulated Open and Close; forces **YesWins / NoWins** at known prices while real Pyth reject paths (stale / wide conf) stay testable. Prod/devnet keeps real **≥4:00 PM ET** settle gate + Pyth quality; sim controls hard-gated (test feature / local validator / Config flag) and **must not weaken** production invariants. Documented one-command/scripted sim lifecycle in-repo alongside calendar automation. UI sim affordance optional for V1. Phoenix V1 spot working assumption (D-015); land path = `glab` (D-014). | Debu / Meridian PM | 2026-10-06 |
| D-018 | `merge_pair` + No intents | Prod ix **`merge_pair`** (inverse of `mint` while Open): burn Yes+No, pay `amount − redeem_fee` USDC, `pairs_minted −= amount`. Pause blocks; **no expiry gate** (OK after `expiry_ts` while Open). Client composition: Buy No = `mint`+ask Yes; Sell No = bid Yes then `merge_pair` (same tx if immediate). No Phoenix wrap in Meridian. Same MR: retire `Settling` (X-07 unused/reserved); admin_settle **Policy A** (`outcome_yes` must match `price >= strike` else `OutcomeInconsistent`). | Meridian Schema | 2026-10-07 |
| D-019 | V1 MAG7 Pyth feeds | Pin **Pyth Core** Hermes `Equity.US.*/USD` feed ids + **shard-0** Solana price accounts for SPEC MAG7 (**AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA**). Alphabet = **GOOGL** (not GOOG). Current Price Feed program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`; receiver owner `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. **Re-pin after Pyth Core upgrade** (`pyt2F414…` PDAs missing on mainnet as of 2026-10-07). Full table in [`SCHEMA.md`](SCHEMA.md) §3.1. | Meridian Schema | 2026-10-07 |
| D-020 | Phoenix client sizing (correction) | **Correction to the !33 Reviewer-High sign-off:** `@ellipsis-labs/phoenix-sdk` `*fromTemplate` `sizeInBaseUnits` is **raw base units (whole tokens)** — the SDK computes `rawBaseUnitsToBaseLotsRoundedDown(size)` (`market.ts`). It is **not** atoms. `contractsToRawAmounts` now returns `phoenixBaseUnits = contracts` and `mintRaw = contracts × 10^decimals`; invariant `phoenixBaseUnits × 10^decimals == mintRaw` (`size.test.ts`). The !33 "mint raw == Phoenix size (atoms)" claim oversized every Phoenix order by 10⁶. Found when placing real orders against Phoenix V1 on localnet. | Grok Bot (Orchestrator) | 2026-10-07 |
| D-021 | Order ticket: no post-only (V1) | **Post-only is hidden in V1** (simplification per Debu). It is not in SPEC; it came only from the UI design docs (`docs/ui/03`, `06` §1.1). The ticket renders Market \| Limit only, has no "Post only" checkbox or post-only crossing warning, and always sends post-only = false. The `post-only` Phoenix order-type path in `apps/web/src/lib/phoenix` is kept, unused, for a possible later toggle. | Debu / Grok Bot | 2026-10-07 |
| D-022 | UI selection & active states (standing rule) | **Anything clicked or selected must be clearly highlighted or identifiable across the whole UI** (Debu). One shared treatment in `globals.css`: accent border + tinted background + 2px ring (`--sel-color`, Yes/No or bid/ask where meaningful), ✓ on pressed chips, separate `:focus-visible` ring, and a disabled look (dashed, greyscale, no tint) distinct from both unselected and selected. Visuals key off ARIA: `aria-pressed` toggles, `aria-selected` tabs/rows, `aria-current` nav/current item. Spec: [`ui/README.md`](ui/README.md) "Selection & active states". | Debu / Grok Bot | 2026-10-07 |
| D-023 | Settle replay proof — no program change | The market-page **settlement proof** (DLV-076) is built from data already on-chain: `StrikeMarket` (status, `settlement_price_e6`, `settled_at_ts`, `settled_slot`, `pyth_feed_id`, `pyth_price_feed`) plus the `Settled` / `AdminSettled` event in the settle tx logs, located client-side via `getSignaturesForAddress(market)`. **No program change.** Known gaps accepted for V1: the Pyth **publish time/slot** of the price used is not stored (settle enforced the D-005 staleness gate), the Pyth **expo** is not in the event (conf scaled with the feed account's current expo), and the settle **tx signature** depends on RPC history retention (falls back to account values with a note). Revisit (add `publish_slot`/`expo` to `Settled`) only if Peak6 wants an archival proof without RPC history. | Grok Bot (Orchestrator) | 2026-10-07 |

## Explicitly not locked (see AI_LOG)

| Topic | Status |
| --- | --- |
| Phoenix **V1 spot** product confirmation | **OBSOLETE as OPEN** — superseded by **D-015**: working assumption (widget skipped) |
| Phoenix base Yes vs No | **Obsolete as OPEN** — locked **D-004 / D-015** (Yes base) |
| Exact MAG7 Pyth feed ids | **Obsolete as OPEN** — proposed lock **D-019** (SCHEMA §3.1); awaiting Debu merge |
| Strike `>=` vs `>` | Default `>=` (**D-005**); Schema proposes close §8 open unless Peak6 wants strict `>` |

## Obsolete / superseded notes

| Ref | Note |
| --- | --- |
| D-011 | Prior “CloudAgent/MCP blocked” wording — **obsolete**; see D-014 |
| AI_LOG 15:40:30 | Historical tooling note; reworded — not a program blocker |
| Phoenix V1 spot “OPEN” | **Obsolete**; D-015 working assumption |
