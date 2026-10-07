# Peak6 Meridian V1 SPEC

| Field | Value |
| --- | --- |
| **Title** | Peak6 Meridian V1 SPEC |
| **Status** | **Freeze candidate** (awaiting Debu lock ping) |
| **Owner** | Meridian PM |
| **Date** | 2026-10-06 (America/Chicago) |
| **Forge** | https://labs.gauntletai.com/debudash/peak6-meridian (GitLab-only; D-001 / D-014) |

**Canonical companions:** [`DECISIONS.md`](DECISIONS.md) · [`SCHEMA.md`](SCHEMA.md) · [`TRACKER.md`](TRACKER.md) · [`TEST_MATRIX.md`](TEST_MATRIX.md) · [`DEPLOY.md`](DEPLOY.md) · [`ui/`](ui/) · [`ui/wireframes/`](ui/wireframes/) · [`sim-clock.md`](sim-clock.md)

---

## 1. Product summary

Meridian is a **non-custodial** Solana dApp for **binary Yes/No** outcome markets on **MAG7** equities (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA), same-day / **0DTE** daily closes.

- Users mint Yes/No pairs against **USDC** collateral; **$1 USDC binary payout** invariant (D-006).
- Trade on **Phoenix CLOB** — **integrate** existing Phoenix markets; **do not** build a Meridian matching engine (D-002 / D-015).
- Settle from **Pyth** equity closes with quality gates (D-005); redeem winning side 1:1 for USDC.
- Stack: **Solana + Anchor** program · **Node** AM/PM automation · **Next.js** frontend · app/automation host = **Railway** (see [`DEPLOY.md`](DEPLOY.md)).
- Source of truth: **Gauntlet Labs GitLab only** via `glab` (D-001 / D-014). Never GitHub / Origin for Meridian.

This SPEC is the freeze-ready product/engineering contract Debu can lock. After lock, material changes require a [`DECISIONS.md`](DECISIONS.md) update.

---

## 2. Locked stack (cite D-001…D-017)

| ID | Topic | Decision (summary) |
| --- | --- | --- |
| D-001 | SCM | Gauntlet Labs GitLab `debudash/peak6-meridian` is source of truth; never GitHub/Origin |
| D-002 | Stack | Solana + Anchor; Phoenix CLOB (integrate); Pyth equity closes; USDC collateral |
| D-003 | Units | `PRICE_SCALE = 1e6` for strike / settlement / Yes price |
| D-004 | Phoenix wiring | Base = Yes mint; quote = USDC (single book; UI maps No) |
| D-005 | Settle gates | Max staleness **150 slots**; max conf **500 bps**; Yes if `settle ≥ strike` |
| D-006 | Payout | $1 USDC binary; vault covers pairs minted; fees default **0 bps** |
| D-007 | Repo | Private project created on `labs.gauntletai.com` |
| D-008 | Orchestration | Grok Bot = chief orchestrator; owns completeness + security |
| D-009 | Agents | Specialists: PM, Schema, UI, Engineers, Testers, Reviewers |
| D-010 | Delivery | Schema ∥ UI in parallel; Engineers consume both |
| D-011 | Tooling (hist.) | CloudAgent/MCP “blocker” framing **obsolete** → D-014 |
| D-012 | Docs set | Required artifact list (this SPEC + companions) |
| D-013 | Schema land | Schema slice via MR on GitLab (not main-only AI_LOG) |
| D-014 | Land path | Official land path = **`glab`** + `GITLAB_HOST=labs.gauntletai.com` |
| D-015 | Phoenix V1 | **Phoenix V1 spot** = working assumption (Yes/USDC book) |
| D-016 | TDD | Failing tests first for vault $1, mint, settle, redeem, pause |
| D-017 | Anytime sim | V1 **hard acceptance**: E2E without waiting for real 9:30/4:00 ET; sim open/close; force YesWins/NoWins; prod gates intact; feature-gated `localnet-test` |

Full rows: [`DECISIONS.md`](DECISIONS.md).

---

## 3. V1 acceptance criteria (MUST pass)

### 3.1 Custody & control

- Non-custodial **PDA vault**; admin **cannot** drain user collateral in production builds.
- Global **pause** works: blocks mint / create; settle + redeem still succeed (per SCHEMA).
- Localnet-only fixtures (`test_drain_vault`, `upsert_mock_pyth`, `sim_*`) **absent** from prod `.so` / `idl/meridian.prod.json`.

### 3.2 $1 invariant

- After mint / Phoenix trade / redeem (fee=0): vault and supplies satisfy TEST_MATRIX I1–I4 (and fee cases when bps ≠ 0).
- Proof: unit/integration tests on main (P0/P1 green; localnet suite presently **60/60** including SIM).

### 3.3 MAG7 0DTE lifecycle

End-to-end: **create → mint → Phoenix trade → settle → redeem** for a same-day MAG7 strike market.

### 3.4 Phoenix

- One **Yes/USDC** book per strike (D-004 / D-015).
- Four trading intents via Phoenix SDK (Buy/Sell Yes/No as mapped in [`ui/06-trading-intents-and-constraints.md`](ui/06-trading-intents-and-constraints.md)).
- Seats / ATAs as required by Phoenix; Meridian does **not** match orders.

### 3.5 Pyth settle

- Staleness ≤ **150 slots**; conf ≤ **500 bps** (D-005).
- Outcome: settle price **≥** strike ⇒ **Yes** wins; else No (default; see open items for `>` revisit).
- Settlement outcome **immutable** once written; `admin_settle` only after configured delay.
- Production settle path parses real Pyth Price accounts; rejects Meridian mock magic.

### 3.6 D-017 Anytime sim (hard acceptance)

- E2E create→mint→(trade)→settle→redeem **without waiting** for real US equity **9:30 / 4:00 ET**.
- Harness drives simulated **open** and **close**; can force **YesWins / NoWins** at known prices.
- Real Pyth reject paths (stale / wide conf) remain testable.
- Prod/devnet keeps real **≥4:00 PM ET** settle gate + Pyth quality; sim controls **hard-gated** (`localnet-test` / local validator) and **must not weaken** production invariants.
- Documented **one-command / scripted** sim lifecycle in-repo (alongside calendar automation).
- UI sim affordance is **optional** for V1.

### 3.7 Stack & hosting

- Anchor program + Node AM/PM automation + Next.js **five pages** (landing, markets, trade, portfolio, history — see [`ui/`](ui/)).
- **Railway** = staging → prod host for **app + automation** per [`DEPLOY.md`](DEPLOY.md); program deploy is on-chain (CLI), not Railway.

### 3.8 TDD & proof (D-016)

- Failing tests first for vault $1, mint, settle, redeem, pause; then implement.
- Proof artifacts: invariant unit tests + E2E + four trade paths + multi-user where applicable (TEST_MATRIX P0/P1/SIM).

### 3.9 Forge

- All work and MRs on Gauntlet GitLab via **`glab`** (D-014).

### 3.10 UI wireframes (SPEC freeze artifact)

Debu requires **UI wireframes in this SPEC freeze MR** (!20 / branch `docs/d012-spec-freeze`) — **not** a separate MR.

| Requirement | Detail |
| --- | --- |
| Owner | Meridian UI (pushes to same branch); Meridian PM keeps SPEC/TRACKER pointers current |
| Location | [`docs/ui/wireframes/`](ui/wireframes/) |
| Coverage | One wireframe (or short multi-state set) per V1 surface: **Landing**, **Markets**, **Trade**, **Portfolio**, **History** |
| Normative link | Wireframes must align with [`ui/01`–`05`](ui/) + [`ui/06-trading-intents-and-constraints.md`](ui/06-trading-intents-and-constraints.md) (four intents, one book, no Yes+No from Trade UI) |
| Format | PNG/SVG (or HTML snapshot) checked into GitLab; index in [`ui/wireframes/README.md`](ui/wireframes/README.md) |
| Freeze gate | SPEC lock waits until wireframes are on this MR **or** Debu explicitly locks without them |

---

## 4. Explicit non-goals

- Mainnet / real funds for core demo **if not yet required** by Debu for the platinum walkthrough (devnet/localnet may suffice until ops ladder advances).
- KYC, custody services, margin/leverage.
- Custom Meridian **matching engine** (Phoenix only).
- **Regulatory / compliance claims** — do not invent or publish any.
- UI sim affordance as a V1 **requirement** (optional per D-017).
- CloudAgent / MCP GitLab as a required land path (obsolete; D-014).

---

## 5. Surfaces & ownership

| Surface | Owner | Notes |
| --- | --- | --- |
| On-chain program (vault, mint, settle, redeem, pause, sim gates) | Meridian Engineers + Schema | SCHEMA / accounts / flows / sim-clock |
| Phoenix integration (book wiring, seats, SDK intents) | Meridian Engineers + UI | D-015 spot assumption |
| Automation (calendar AM/PM + dual-mode sim path) | Meridian Engineers | Must not weaken prod invariants |
| Next.js five pages + freeze wireframes | Meridian UI → Engineers | Specs in `docs/ui/`; wireframes in `docs/ui/wireframes/` on MR !20 |
| TEST_MATRIX + failing suites | Meridian Testers | D-016 TDD |
| Security + demo readiness | Meridian Reviewers | RED_TEAM checklist; demo walkthrough |
| SPEC / TRACKER / orchestration | Meridian PM + Grok Bot | D-008 / D-012 |

---

## 6. Open items still allowed post-freeze (narrow)

These may resolve after SPEC lock without rewriting V1 scope:

1. Exact **MAG7 Pyth feed ids** (placeholders until pinned).
2. Phoenix **Buy/Sell No** composition completeness + real on-book trade in sim E2E (today: off-book Yes SPL placeholder in SIM suite).
3. Indexer / history data URL (if any).
4. Optional **UI sim** affordance.
5. **SimClock PDA** eng impl (`init`/`set`/`warp`) per [`sim-clock.md`](sim-clock.md) — docs landed; **not** required by SIM-01…09.

Strike `>=` vs `>` remains default `>=` unless product revisits (DECISIONS “not locked”).

---

## 7. Deploy ladder pointer

Full ladder: [`DEPLOY.md`](DEPLOY.md).

| Stage | Summary |
| --- | --- |
| Localnet | Box + CI; `localnet-test` fixtures allowed |
| Devnet staging | **Prod build only**; real Pyth/Phoenix |
| Railway staging | Next.js + Node automation → **devnet** RPC |
| Railway prod | Next.js + Node automation → **mainnet** RPC |

**Hard rule:** never deploy `--features localnet-test` to devnet/mainnet. CI asserts prod `.so` / IDL have no fixture strings.

---

## 8. Freeze process

1. **This MR (!20)** lands `docs/SPEC.md` as **freeze candidate** and hosts **UI wireframes** under [`ui/wireframes/`](ui/wireframes/) (same MR / branch — Debu: no separate wireframe MR).
2. Meridian UI pushes wireframe assets to `docs/d012-spec-freeze`; PM keeps §3.10 + TRACKER in sync.
3. **Debu lock** = Debu notifies **Grok Bot + Debu** (chat/ping) that SPEC is locked (wireframes included unless Debu waives).
4. After lock: material scope/stack changes require a new row (or amendment) in [`DECISIONS.md`](DECISIONS.md) and an [`AI_LOG.md`](AI_LOG.md) entry.
5. TRACKER / TASKS may continue to move work items; they do not silently expand V1 acceptance without Debu awareness.

**Status wording until Debu lock ping:** Freeze candidate — **not** yet locked. Wireframes expected on this MR before lock.
