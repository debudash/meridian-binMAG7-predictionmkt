# Design note: a Meridian PDA as the Phoenix Seat Manager authority (review mr72-73 M1)

| | |
| --- | --- |
| **Status** | **Approved by Reviewers with changes** (`/workspace/meridian-review-mr77-79.md`, `mr-79`). Changes folded in below (§3, §4, §5, §8, §9). **Design only: still no program change.** Mainnet gate. |
| **Finding** | `/workspace/meridian-review-mr72-73.md` **M1**: the hot pauser key (`PHOENIX_PAUSER_KEYPAIR`, a Railway secret) *is* the full Phoenix Seat Manager (PSM) authority of every handed-off book. |
| **Tracker** | DLV-105 (design + build) · DLV-112 (M1-closing conditions, §9) |
| **Related** | DLV-097 (pause at expiry, !73) · DLV-102 (handoff repair, !77) · DLV-104 (M2 monitoring + pauser rotation runbook) · `apps/automation/src/phoenix/seatManager.ts` · `docs/runbooks/PAUSER_ROTATION.md` |

## 1. Problem

Staging books hand their Phoenix market authority to the PSM PDA `[market]` under `PSMxQb…`. PSM keeps **one** authority per book (`SeatManager.authority`), and today that is the hot pauser key. That key can do far more than pause:

| PSM instruction | What the hot pauser can do with it |
| --- | --- |
| `ChangeMarketStatus` (8) | Set **any** status, including **Paused → Active** after expiry. |
| `NameSuccessor` (6) / `ConfirmRenounceSeatManagerAuthority` (11) | Move the SM authority to any key, or burn it. |
| `NameMarketAuthoritySuccessor` (9) | Name a raw Phoenix market authority. That key then claims it with Phoenix `ClaimAuthority` (101) and leaves PSM for good. |
| EvictSeat, add/remove DMM, `ChangeMarketFeeRecipient` | Grief seats; redirect fees. |

Reviewers proved the 9 → 101 escape on localnet with the real programs.

**Blast radius of a Railway leak**
- Every book can be unpaused after the outcome is known, so stale maker orders can be picked off.
- Every book can be taken out of ops control permanently.
- Fees can be redirected.

Vault funds can't be stolen.

A **lost** key is also unrecoverable: PSM has no override.

DLV-104 lowers the risk but doesn't remove it. It adds M2 monitoring (re-pause and ALERT), a rotation runbook and an offline backup. **Mainnet needs the hot key gone.**

## 2. Goal and non-goals

Goals:
1. Nothing that lives on Railway or the box can unpause, rotate, rename, renounce, evict or hand off a book.
2. Pausing at expiry stays automatic and does **not** depend on any privileged key. Anyone can trigger it, so a dead keeper can be replaced by any wallet.
3. The pause can happen **only after expiry**, and it can **only ever set `Paused`**.

Non-goals (for this change):
- Post-settle `Paused → Closed`, seat eviction, and fee recipient changes. See §7.
- Any change to settle, mint, redeem or Phoenix trading.

## 3. Design

### 3.1 The authority PDA

Each StrikeMarket gets a Meridian program PDA:

```
book_pauser = PDA(meridian_program_id, [b"book_pauser", strike_market.key()])
```

- It is **per StrikeMarket**, not global, so one PDA can only ever sign for one book. Even a bug in the binding check below can't reach another book.
- It holds no lamports and no data. It exists only as a signer, via `invoke_signed`.
- Seeds are a program constant `BOOK_PAUSER_SEED = b"book_pauser"`; the handler requires the **canonical** bump. No other
  Meridian seed starts with `b` (`config`, `sim_clock`, `strike_market`, `vault_authority`, `yes_mint`, `no_mint`,
  `collateral_vault`), so no seed concatenation can collide (Reviewers !79 Q1).
- **CI gate:** `rg BOOK_PAUSER_SEED programs/` must match only the `pause_book` and `claim_book_pauser` handlers (plus the
  constant), in the style of `scripts/assert-prod-no-fixtures.sh`.
- It becomes `SeatManager.authority` for that book's Phoenix market (§4).

### 3.2 New instruction `pause_book` (permissionless)

**Accounts**

| Account | Mutable | Signer | Checks |
| --- | --- | --- | --- |
| `caller` | | yes | Anyone; pays the fee. No authority check. |
| `strike_market` | | | Meridian-owned `StrikeMarket`. |
| `book_pauser` | | | `seeds = [b"book_pauser", strike_market.key()]`, canonical bump. |
| `phoenix_program` | | | `== PhoeNiXZ8…` |
| `phoenix_log_authority` | | | `== PDA(phoenix, [b"log"])` |
| `phoenix_market` | yes | | `== strike_market.phoenix_market` (≠ default); owner == Phoenix; data ≥ 240 bytes before the header read. |
| `seat_manager` | yes | | `== PDA(PSM, [phoenix_market])`. Writable because Phoenix marks its authority writable (same quirk as `psmChangeMarketStatusIx`). |
| `psm_program` | | | `== PSMxQb…` |

**Handler**
1. `now = Clock::get()?.unix_timestamp` (the **cluster clock**).
   - On mainnet / prod builds this is the real clock only. The cluster clock is a stake-weighted estimate that can
     drift from wall time by seconds (more under load); accepted and documented (Reviewers !79 Q3).
   - The localnet-test sim clock is compiled in **only** under `feature = "localnet-test"`; `assert-prod-no-fixtures.sh`
     is extended so the prod `.so` has no `pause_book` sim-clock path.
2. If `now < strike_market.expiry_ts − PAUSE_LEAD_SECS`, fail with `ExpiryNotReached` (existing error).
   `PAUSE_LEAD_SECS = 5` is a **fixed program constant (5 s lead)**, equal to the web trading cutoff; not configurable
   (Reviewers' call on the §5 timing question). It can only start Paused early, inside a window the UI already closes,
   and removes the post-expiry window where stale makers get picked off.
3. Read the Phoenix market header: status u64 @8, authority @208.
   - Status already `Paused` (3), `Closed` (4) or `Tombstoned` (5): return `Ok` as a **no-op**. It is idempotent, so racing callers don't fail. It must **not** move Closed → Paused (valid in Phoenix, but not wanted).
   - Status not `Active` (1) or `PostOnly` (2): no-op.
4. CPI to PSM `ChangeMarketStatus` (8) with data `[8, 3]`. **The status byte is the constant `Paused`; it is never taken from instruction data.** The accounts are the same five as `psmChangeMarketStatusIx`, with `book_pauser` as the signer, signed via `invoke_signed(&[b"book_pauser", strike_market.key().as_ref(), &[bump]])`.
5. Emit `BookPaused { strike_market, phoenix_market, caller, ts }`.

**What it can't do, by construction**
- No instruction data selects a status, so there's no unpause path.
- The program has **no** instruction that CPIs PSM 6, 9, 11, eviction, DMM or fee changes with `book_pauser` seeds. A PDA can only sign what its own program asks it to sign, so 9 → 101 can't happen.
- The binding `phoenix_market == strike_market.phoenix_market` plus the per-market seeds limit each call to the book Meridian recorded for that market.
- It doesn't check `config.paused`. Pausing a book is always safe, and must still work when the protocol is paused.

**CPI depth.** Worst case: Meridian (1) → PSM (2) → Phoenix (3) → Phoenix self-CPI log (4): CPI depth 4 of the runtime's
`max_invoke_stack_height` 5 (Reviewers checked the runtime source). That leaves room for exactly **one** wrapper (a
multisig or crank program calling `pause_book` reaches 5). The localnet test (§6) must confirm it with the real `.so`
files, including one wrapper.

**PSM accepts the PDA signer.** Every PSM authority check is `Signer::new_with_key(account, &seat_manager.authority)`,
which checks only `is_signer` and the key, not the owner (`phoenix-v1 checkers/mod.rs:84–104`). `invoke_signed` with
`[b"book_pauser", strike_market, bump]` sets `is_signer`, so PSM **ix 8** (ChangeMarketStatus, PDA as `accounts[4]`) and
PSM **ix 7** (ClaimSeatManagerAuthority, PDA as `accounts[1]`) both work. PSM **ix 6** in the migration is signed by
the current hot authority; the PDA is only the named successor (Reviewers !79).

### 3.3 New instruction `claim_book_pauser` (authority-gated, migration only)

PSM `ClaimSeatManagerAuthority` (7) needs the **successor** to sign. A PDA can only sign through its program, so Meridian needs a small claim path.

**Accounts**
- `authority`: signer, `has_one` on `Config`.
- `config`, `strike_market`, `book_pauser`, `phoenix_market` (`== strike_market.phoenix_market`), `seat_manager`, `psm_program`.

**Handler.** CPI to PSM 7 with `book_pauser` seeds.
- It can only make the PDA **accept** an authority that the current SM authority already named with PSM 6. It can't take a book on its own.
- The config authority gets nothing it doesn't already have: it already sets `phoenix_market`. It only completes a handoff.

## 4. Migration (staging → mainnet)

**Existing books** (SM authority = hot pauser). For each book in state, send one tx:
1. PSM `NameSuccessor` (6), signed by the **hot pauser**, with successor = `book_pauser(strike_market)`.
2. Meridian `claim_book_pauser`, signed by the config authority, which CPIs PSM 7.

This uses the same 6 + 7 pattern as today's `handoff` in `ops-cli` (`planHandoff` / `handoff_repair`), with a new target per book.
- Idempotent: books already on the PDA are `ok`.
- Then gate with `pause-status --expect-pauser book_pauser` per book. Expect a per-book PDA; today the expected pauser is one key.

- **Include already-paused and expired books.** Otherwise the hot key keeps unpause power over them (Reviewers !79 Q8).
- Books still on the upgrade key: the same flow, with the upgrade key signing PSM 6.
- Books with a foreign SM authority, or that have left PSM (header authority ≠ SM PDA), **can't be migrated**: list them
  and treat them as lost (cancel and withdraw only; stop routing the UI to them).
- `planHandoff` / `--expect-pauser` need a **per-book** expected authority, and the gate also checks header authority ==
  SM PDA (done for the hot-key gate in the !78 follow-up, N-5).

**New books.** Bind each new book to the PDA **inside the bootstrap transaction**: Phoenix 102 (name the SM PDA) + PSM 0
(ClaimMarketAuthority) + PSM 6 (successor = `book_pauser`) + `claim_book_pauser` in **one** tx, so no key ever holds a
live book's SM authority between transactions.

**After migration**
- Remove `PHOENIX_PAUSER_KEYPAIR` from Railway `automation`.
- The worker keeps its pass loop and M2 monitoring, but sends `pause_book` signed by the **keeper / fee payer**. Any funded key works; it holds no authority.
- `[pause] ALERT` on authority drift now means "SM authority ≠ book_pauser".
- Retire the rotation runbook once no book has a hot authority.

**Order.**
1. Ship the program upgrade (prod build + LiteSVM + localnet).
2. Migrate staging books.
3. Run one full 20-min market cycle on staging.
4. Then mainnet bootstrap uses the PDA from day one.

## 5. Trade-offs and decisions for Reviewers

| Topic | Proposal | Alternative |
| --- | --- | --- |
| Pause timing | **Decided (Reviewers): fixed program-constant 5 s lead**, `now ≥ expiry_ts − 5`, cluster clock. Not configurable. | Strict `now ≥ expiry_ts` (rejected: trading continues until the pause lands). |
| PDA scope | **Decided: per StrikeMarket** `[b"book_pauser", strike_market]` | One global `[b"book_pauser"]` PDA (rejected: a binding bug would reach every book). |
| Recovery | **Decided:** none at the PSM level. A Meridian **program upgrade** (upgrade authority = multisig + timelock on mainnet, or frozen) is the only way to add new powers. No cold recovery key, no `resume_book`. | Keep a cold-storage "recovery" path: re-introduces a key with full powers. |
| Unpause for ops recovery | Not possible after the migration. Ops must create a new market. | An authority-gated `resume_book` valid only **before** expiry: adds an unpause path; not proposed. |

## 6. Test plan (when the program change is built)

1. **Unit / LiteSVM (prod `.so`)**
   - `pause_book` before expiry fails with `ExpiryNotReached`.
   - At or after expiry, Active becomes Paused.
   - Already Paused or Closed: Ok and no-op.
   - Wrong `phoenix_market`, wrong `seat_manager` or wrong PDA: rejected.
   - Any caller works (fresh 0.01-SOL key): fails at `expiry − 5 − 1`, succeeds at `expiry − 5`.
   - A Closed book is a no-op (never Closed → Paused).
   - A re-pointed `phoenix_market` is rejected once set (write-once, §9).
2. **Localnet with the real Phoenix + PSM `.so` files** (opt-in suite, temporary validator on `:8699`):
   - Migrate a book from the hot pauser via 6 + `claim_book_pauser`.
   - The old pauser can no longer call PSM 8 / 6 / 9.
   - `pause_book` pauses at expiry, and CPI depth is OK.
   - A Paused book still allows cancel and withdraw (re-uses the !76 proof).
3. **Negative:** no Meridian instruction can produce PSM 6 / 9 / 11 / evict CPIs with `book_pauser` seeds. Check this with an IDL review, a test that enumerates instructions, and the `BOOK_PAUSER_SEED` CI grep (§3.1).
   - Measure CPI depth with one wrapper program (stack height 5).
4. **Ops:**
   - `handoff_repair` targets `book_pauser`.
   - `pause-status --expect-pauser` passes per book.
   - Worker DRY_RUN exits 0 with no pauser key on Railway.

## 7. Follow-ups

- **In the same program upgrade (Reviewers !79):** authority-gated `close_book`: Paused → Closed only, and only after the
  StrikeMarket is settled. The migration removes every PSM admin power, so adding it later would need another upgrade.
- An external alert sink for `[pause] ALERT` (today: Railway logs). TRACKER DLV-111.

## 8. Reviewers' answers (!79 review, 2026-10-08)

| Question | Answer |
| --- | --- |
| Does PSM accept a PDA signer via `invoke_signed`? | **Yes**, for ix 8 and ix 7 (`Signer::new_with_key` checks `is_signer` + key only). Ix 6 is signed by the hot key during migration. |
| CPI depth | **4 of 5** (Meridian → PSM → Phoenix → Phoenix log). Room for one wrapper. |
| Seeds | `[b"book_pauser", strike_market]`, per market, canonical bump, `BOOK_PAUSER_SEED` constant. No collisions. |
| Other powers on the PDA? | None, as long as the status byte is the constant 3, only `pause_book` and `claim_book_pauser` use the seed (**CI check**), and `claim_book_pauser` only CPIs PSM 7. Hard-code the PSM / Phoenix ids. |
| Clock | Cluster clock (`Clock::get()`) only; sim clock behind `localnet-test` with a prod-build assert; **fixed 5 s lead**. |
| Griefing / early pause | Not meaningful: Paused only, only after expiry − 5 s, only the bound book, idempotent, caller pays. Not checking `config.paused` is correct. |
| Migration | **One tx per book**: PSM ix 6 (current authority, successor = PDA) + `claim_book_pauser`. Include already-paused / expired books. Foreign / left-PSM books are lost. |
| New books | Bind to the PDA **inside the bootstrap tx** (102 + PSM 0 + PSM 6 + `claim_book_pauser`). |
| Rent | None (signer-only PDA, nothing allocated). |
| Closes M1? | **Yes for migrated books**, given the §9 conditions. |

## 9. Conditions to close M1 (required by Reviewers)

1. **`strike_market.phoenix_market` set-once (write-once).** Today `set_phoenix_market` can be re-called by the config
   authority at any time, which could re-point a migrated market and strand `pause_book` (a denial, not an unpause).
   Reject unless the field is still the default (or once `book_pauser` holds the book). Keep the config authority off Railway.
2. **Upgrade authority = multisig with a timelock** (e.g. Squads), **or a frozen program** (`--final` after audit) on
   mainnet. After migration the upgrade authority is effectively every book's SM authority. On staging the box upgrade
   key keeps that latent power: M1 is closed for Railway, not for the box, on devnet.
3. **Fee recipient and market makers (DMMs) final before migration.** The migration removes every PSM admin power;
   set the fee recipient to a treasury (not a hot key) first.
4. **`close_book` in the same upgrade** (§7).
5. Every book migrated (incl. already-paused ones) and `PHOENIX_PAUSER_KEYPAIR` removed from Railway; hot key shredded
   after one clean cycle.
