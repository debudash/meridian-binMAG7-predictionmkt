# Meridian AI decision log

Append-only log of agent decisions and orchestration events for Peak6 Meridian.
Timestamps are America/Chicago (CDT, UTC-5). Newest entries at the top.
Narrative detail lives here; locked decisions are indexed in [`DECISIONS.md`](DECISIONS.md).

---

## 2026-10-06T16:55:00-05:00 — Testers P1 fees failing suite (TDD)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (glab commits API, no clone) |
| **Decision** | Land P1 TDD suite on `test/p1-fees-failing` from `eng/p0-anchor-impl` @ 6618d74 (nits verified). Core fees **M-03 / R-05 / V-06** in `tests/fees.ts`; invited edges **S-08, X-03, M-07, M-09, M-10, V-07, V-08** in `tests/p1_edges.ts`. Harness always re-applies fee bps on config reuse so P1 cannot poison P0 fee=0. **V-07** stays `TDD_RED` (no vault-drain fixture). No Rust fee logic in this MR. |
| **Result** | Branch + MR → `main` (same base as open !9). Engineers rebase after !9; implement **only** to green remaining reds. Do not weaken P0. |
| **Related** | MR !9 (P0 eng), matrix !5, D-016 |

---

## 2026-10-06T16:50:00-05:00 — Testers nits on MR !9 (R-02 / S-11 / I4 / events)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (follow-up); Grok Bot (glab push to `eng/p0-anchor-impl`) |
| **Decision** | Land Testers approve-with-nits on MR !9 before P1 fees suite: (1) **R-02** assert SettledNo → redeem(Yes) → `InvalidWinningMint` (program already enforced; test gap closed); (2) **S-11** assert Yes/No supplies unchanged across settle (SCHEMA §5.4); (3) optional I4 field snapshots on S-09/A-04; (4) optional event listeners on S-01/A-01/R-01 (`settled` / `adminSettled` / `redeemed`). |
| **Result** | `anchor test`: **41 passing / 0 failing**. No suite weakening. Ready for Testers P1 fees (M-03 / R-05 / V-06). |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/9 |

---


## 2026-10-06T16:35:00-05:00 — Eng P0 Anchor impl greens Testers suite (Meridian Engineers / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (impl); Grok Bot (orchestrate; glab land path D-014) |
| **Decision** | Land `eng/p0-anchor-impl` → `main`: full `programs/meridian` Anchor program (initialize/pause/create/mint/settle/admin_settle/redeem/set_phoenix + localnet `upsert_mock_pyth` fixture), regenerated IDL, bankrun-free harness on `solana-test-validator`, P0 case IDs from Testers MR !6 kept in `it()` titles. Includes TEST_MATRIX from MR !5. |
| **Result** | `anchor test`: **41 passing / 0 failing** (~3m). Covers all **37 P0 case IDs** (M/S/A/R/V/X + S-10 unit vectors). Phoenix = pubkey wiring only (D-004/D-015). Pyth = MockPythPrice gates (staleness 150, conf 500 bps, settle ≥ strike) per D-005. |
| **Program id** | `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (localnet placeholder; replace at deploy) |
| **Related** | MR !5 (matrix), MR !6 (failing suite), D-016 TDD |

---

## 2026-10-06T16:04:00-05:00 — TDD mandate for core program invariants (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (mandate); Grok Bot (record + enforce for Engineers/Testers) |
| **Decision** | **TDD is mandatory** for Meridian program work. Write **failing tests first**, then implement, for these core paths/invariants: **vault $1** collateralization (vault covers outstanding pairs at $1 USDC per pair), **mint**, **settle**, **redeem**, and **pause**. Do not ship implementation ahead of red tests for these. |
| **Rationale** | Locks engineer workflow to prove vault/mint/settle/redeem/pause behavior before green code; reduces silent invariant breaks on the platinum demo path. See **D-016**. |
| **Applies to** | Anchor program (`programs/meridian`), Tester plans, Reviewer gates |

---

## 2026-10-06T15:52:00-05:00 — Unblock: glab official land path; Phoenix V1 spot assumed (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (decision); Grok Bot (record + enforce) |
| **Decision** | **Cursor enterprise GitLab + MCP GitLab 404 are NOT blockers.** Official SCM land path = **`glab`** against `labs.gauntletai.com` (`GITLAB_HOST=labs.gauntletai.com`, existing `glab` auth / `GAUNTLET_GITLAB_TOKEN`). **Phoenix V1 spot** is the **working assumption** (confirmation widget skipped — do not invent a separate Debu confirm). Reword prior “blocker” language accordingly; ship via branch `docs/unblock-glab-path` + MR. |
| **Rationale** | CloudAgent/MCP gaps are tooling preferences, not program stalls. Schema/UI already land via `glab`; treat that as the sanctioned path. Spot assumption unblocks Engineers without a confirmation widget. See D-014 / D-015. |
| **Supersedes** | Framing in the 15:40:30 “Tooling blockers” entry and D-011 “blocked” wording; Phoenix V1 spot “OPEN / do not treat as confirmed” caution → working assumption (D-015). |

---

## 2026-10-06T15:48:00-05:00 — UI design slice MR (Meridian UI)

| Field | Value |
| --- | --- |
| **Actor** | Meridian UI |
| **Decision** | Open MR `ui/docs-slice` → `main` with engineer-ready UI specs under `docs/ui/` (Landing, Markets, Trade, Portfolio, History + intents/constraints + IA/routes). Append this log entry on `main` (Schema MR !1 already merged; `schema/docs-slice` gone) so AI_LOG stays single-threaded with Schema. |
| **Rationale** | Parallel UI slice; land via `glab` API on labs.gauntletai.com (same as Schema). Cursor CloudAgent/MCP unavailable — **not blockers** (see 15:52 / D-014). |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/2 |
| **Commit** | `a3c5a63d` |

Key UI locks in this slice: one Phoenix Yes/USDC book with No as display transform; four intents (Buy/Sell × Yes/No); trading UI blocks simultaneous Yes+No exposure (balances + open buys + in-flight); settlement countdown component; payoff copy "1.00 USDC if right, 0 if not". Open `TODO(schema)` / `OPEN:` tags remain in the docs.

---

## 2026-10-06T15:46:00-05:00 — Orchestration log completeness (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Append full orchestration history to this file on branch `schema/docs-slice` (MR !1); expand `DECISIONS.md` locks; do **not** open a second MR or push a parallel AI_LOG to `main` |
| **Rationale** | Schema already landed `docs/AI_LOG.md` + `DECISIONS.md` via MR !1. A parallel main commit would fork the log. Completeness + security ownership requires one append-only narrative covering repo, stack, agents, tooling notes, open assumptions, and required docs. |

---

## 2026-10-06T15:45:55-05:00 — Schema MR !1 opened (Meridian Schema / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema (commit); Grok Bot (orchestrate) |
| **Decision** | Open MR !1 `schema/docs-slice` → `main`: schema docs + companion units/accounts/flows + scaffold map + initial AI_LOG/DECISIONS |
| **Rationale** | Land schema slice for review without blocking `main` README; keep forge on Gauntlet Labs GitLab only. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/1 |
| **Commit** | `8578ea4` — `docs(schema): Anchor layouts, Phoenix/Pyth linkage, units, flows` |

---

## 2026-10-06T15:42:00-05:00 — Schema drafted locally (Meridian Schema)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | Draft on-chain schema docs locally under `/workspace/meridian-schema-docs` before API commit to GitLab: `SCHEMA.md`, `accounts.md`, `flows.md`, `units.md`, `programs/meridian/README.md` |
| **Rationale** | Local draft → `glab`/API push to `schema/docs-slice` is the sanctioned land path (CloudAgent/MCP optional; **not blockers** — see 15:52 / D-014). UI work proceeds in parallel under `/workspace/meridian-ui-specs` (to be committed as `docs/ui/`). |

---

## 2026-10-06T15:41:00-05:00 — Required docs artifacts list (Debu → Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (requirement); Grok Bot (track) |
| **Decision** | Track and eventually ship these docs artifacts in-repo (names as given): |

| Artifact |
| --- |
| `AGENTS` |
| `AI_LOG` |
| `ARCHITECTURE` |
| `CLAUDE` |
| `CONTEXT` |
| `DECISIONS` |
| `DEMO_SCRIPT` |
| `DEPLOY` |
| `DIAGRAMS` |
| `EVALS` |
| `METRICS` |
| `ORCHESTRATOR_KICKOFF` |
| `README` |
| `RED_TEAM` |
| `SPEC` |
| `TASKS` |
| `TRACKER` |

| Field | Value |
| --- | --- |
| **Rationale** | Platinum deliverable set for Peak6 / Gauntlet; AI usage log (`AI_LOG`) is mandatory. Schema MR seeds `AI_LOG` + `DECISIONS` + schema companions; remaining stubs/docs are follow-on tasks. |

---

## 2026-10-06T15:40:30-05:00 — Tooling note (historical): CloudAgent + MCP GitLab (Grok Bot) — NOT blockers (see 15:52 / D-014)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot |
| **Decision** | Prefer box-local draft + `glab` / GitLab REST with `GITLAB_HOST=labs.gauntletai.com` and `GAUNTLET_GITLAB_TOKEN`. Cursor CloudAgent (enterprise host not in Settings) and MCP GitLab (**404**) are **unavailable conveniences — not program blockers**. Official land path = `glab` (confirmed 15:52 / D-014). |
| **Rationale** | CloudAgent is not configured for `labs.gauntletai.com`; MCP GitLab returns **404**. Those gaps do **not** stall Meridian — `glab` works and is the official land path. (Superseding “blocker” framing: see 15:52 entry / D-014.) |

---

## 2026-10-06T15:40:00-05:00 — Specialist agents spawned (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Create six Meridian specialist agents; Grok Bot remains chief of staff / chief orchestrator owning **completeness** and **security** across slices. |

| Specialist | Role |
| --- | --- |
| Meridian PM | Requirements, acceptance criteria, prioritization, trade-offs |
| Meridian Schema | Anchor accounts, PDAs, events, units, automation shapes |
| Meridian UI | Next.js IA / wireframes: Landing, Markets, Trade, Portfolio, History |
| Meridian Engineers | Anchor/Rust, Next.js/TS, Node automation, Phoenix + Pyth + USDC |
| Meridian Testers | Unit/integration/frontend plans; invariant gates; lifecycle scenarios |
| Meridian Reviewers | Architecture, security (non-custodial, pause, admin delay), docs/AI_LOG, demo readiness |

| Field | Value |
| --- | --- |
| **Rationale** | Parallel Schema + UI slices need clear ownership; Engineers/Testers/Reviewers consume PM + Schema + UI outputs. Grok Bot does not replace specialists — orchestrates, enforces GitLab-only forge, and owns end-to-end completeness + security. |
| **Repo constraint (all agents)** | https://labs.gauntletai.com/debudash/peak6-meridian only — never GitHub / Origin. |

---

## 2026-10-06T15:39:30-05:00 — PM V1 acceptance bar, non-goals, parallel slices, Phoenix spot assumption (Meridian PM / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM (bar); Grok Bot (orchestration) |
| **Decision** | Adopt V1 acceptance bar + non-goals; run **Schema** and **UI** as parallel slices; treat **Phoenix V1 spot** as the working assumption (confirmation widget **skipped** — later confirmed as D-015 / 15:52). |

### V1 acceptance bar (minimum)
- Non-custodial dApp: mint Yes/No pairs vs USDC, trade on Phoenix Yes/USDC book, settle via Pyth ~4:00 PM ET, redeem winners 1:1 USDC
- MAG7 0DTE binary markets; Yes + No payout identity = $1 USDC; vault covers outstanding pairs
- On-chain: Config, Create Strike Market, Mint, Settle, Admin Settle (delayed), Redeem, Pause/Unpause
- Frontend surfaces: Landing, Markets, Trade, Portfolio, History
- Stack: Solana + Anchor, Phoenix (integrate), Pyth, USDC; Next.js/TS frontend; Node/TS automation
- Core submission: **never mainnet**
- Docs/demo: source + tech docs + demo + deploy guide + test results + AI usage log

### Non-goals (V1)
- Custom matching engine / home-grown CLOB
- Multi-collateral
- Inventing regulatory/compliance claims
- On-chain code in the schema docs slice (scaffold map only)
- Phoenix spot confirmation widget / invented Debu confirmation of spot wiring

### Working assumption — Phoenix V1 spot (locked as assumption in D-015)
- **Assumption:** V1 uses Phoenix **spot** markets (Yes base / USDC quote) as Schema defaulted.
- **Status:** **WORKING ASSUMPTION** (Debu / Grok Bot, 15:52) — confirmation widget **skipped**; do not invent a separate confirm. Schema/UI/Engineers proceed on spot. Revisit only if Debu explicitly changes product direction.

| Field | Value |
| --- | --- |
| **Rationale** | Unblocks parallel Schema/UI without inventing product confirmation; keeps risk visible in AI_LOG. |

---

## 2026-10-06 — Schema slice defaults (Meridian Schema)

**Agent:** Meridian Schema  
**Repo path:** `docs/SCHEMA.md` (+ companions)  
**Status:** Proposed on branch `schema/docs-slice` (land via MR !1)

### Locked defaults
| Decision | Choice | Rationale |
| --- | --- | --- |
| Price / strike / settlement / Yes price scale | `PRICE_SCALE = 1_000_000` (1e6) | Align with USDC + outcome mint decimals (6) |
| Phoenix base mint | Yes outcome mint | Single Yes/USDC book; UI maps No via inverse |
| Phoenix quote mint | Collateral (USDC) | Standard CLOB quote |
| Custom matching | **Do not build** — integrate Phoenix only | Stack lock |
| Pyth max staleness | 150 slots | Settle gate |
| Pyth max confidence ratio | 500 bps (5%) | Reject noisy prints |
| Yes wins if | `settlement_price_e6 >= strike_price_e6` | Inclusive touch |
| Binary payout | $1 USDC per winning token | Vault covers outstanding pairs |
| Protocol fees | Fields present; default **0 bps** | Can enable later without layout change |
| Pause behavior | Blocks mint/create; settle+redeem still allowed | Protect LPs / resolution |
| Forge | Gauntlet Labs GitLab only (`labs.gauntletai.com/debudash/peak6-meridian`) | No GitHub/Origin |

### Accounts / instructions / events (summary)
- Accounts: `Config`, `StrikeMarket`, vault authority PDA, Yes mint, No mint
- Instructions: create market, mint, settle, admin_settle, redeem, pause, set_phoenix_market
- Events: MarketCreated, Minted, Settled, Redeemed (+ config/pause updates as needed)

### Open questions (see SCHEMA.md §8)
1. Phoenix base side (Yes vs No) — default Yes pending PM/UI confirm
2. Exact MAG7 Pyth feed ids / price accounts
3. `>=` vs `>` on strike
4. `equity_symbol` `[u8;8]` vs AssetRegistry PDA
5. StrikeMarket PDA seeds `(symbol, expiry, strike)` vs `market_id` only
6. Whether v1 includes `burn_losing`
7. Fee policy beyond 0 bps defaults
8. Settle-window policy vs automation retries
9. Multi-collateral — out of scope for v1
10. **Phoenix V1 spot** — **working assumption** (D-015); widget skipped; not a blocker (see 15:52)

### Non-goals this slice
- No Anchor program source yet (scaffold map only under `programs/meridian/`)
- No custom CLOB
- No frontend work (parallel track)

---

## 2026-10-06T15:33:45-05:00 — Stack lock + GitLab-only mandate (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (lock); Grok Bot (enforce for all agents) |
| **Decision** | **Stack:** Solana + Anchor (Rust); **CLOB:** Phoenix (integrate existing — do not build matching); **Oracle:** Pyth equity closes. **Forge:** Gauntlet Labs GitLab **ONLY** — `https://labs.gauntletai.com/debudash/peak6-meridian`. Never GitHub, never Cursor Origin remotes for Meridian source of truth. |
| **Rationale** | Matches Peak6 / Gauntlet private platinum brief; Phoenix + Pyth are preferred integrations; multi-forge would desync agents and leak private work. |

---

## 2026-10-06T15:33:33-05:00 — Private repo created (Debu)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash |
| **Decision** | Create private project `debudash/peak6-meridian` on `labs.gauntletai.com` (default branch `main`, initial README only). |
| **Rationale** | Single private forge for Meridian (Peak6) agent + human collaboration. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian |
| **Commit** | `4e449f8` — `Initial commit` |
