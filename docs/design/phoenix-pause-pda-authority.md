# Design note: a Meridian PDA as the Phoenix Seat Manager authority (review mr72-73 M1)

| | |
| --- | --- |
| **Status** | Proposed. **Design only: no program change in this MR.** Mainnet gate. |
| **Finding** | `/workspace/meridian-review-mr72-73.md` **M1**: the hot pauser key (`PHOENIX_PAUSER_KEYPAIR`, a Railway secret) *is* the full Phoenix Seat Manager (PSM) authority of every handed-off book. |
| **Tracker** | DLV-105 |
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
| `phoenix_market` | yes | | `== strike_market.phoenix_market` (≠ default). |
| `seat_manager` | yes | | `== PDA(PSM, [phoenix_market])`. Writable because Phoenix marks its authority writable (same quirk as `psmChangeMarketStatusIx`). |
| `psm_program` | | | `== PSMxQb…` |

**Handler**
1. `now = Clock::get()?.unix_timestamp`.
   - On mainnet / prod builds this is the real clock only.
   - The localnet-test sim clock may be honoured only under `feature = "localnet-test"`, the same way as `effective_clock`.
2. If `now < strike_market.expiry_ts`, fail with `ExpiryNotReached` (existing error).
3. Read the Phoenix market header: status u64 @8, authority @208.
   - Status already `Paused` (3), `Closed` (4) or `Tombstoned` (5): return `Ok` as a **no-op**. It is idempotent, so racing callers don't fail.
   - Status not `Active` (1) or `PostOnly` (2): no-op.
4. CPI to PSM `ChangeMarketStatus` (8) with data `[8, 3]`. **The status byte is the constant `Paused`; it is never taken from instruction data.** The accounts are the same five as `psmChangeMarketStatusIx`, with `book_pauser` as the signer, signed via `invoke_signed(&[b"book_pauser", strike_market.key().as_ref(), &[bump]])`.
5. Emit `BookPaused { strike_market, phoenix_market, caller, ts }`.

**What it can't do, by construction**
- No instruction data selects a status, so there's no unpause path.
- The program has **no** instruction that CPIs PSM 6, 9, 11, eviction, DMM or fee changes with `book_pauser` seeds. A PDA can only sign what its own program asks it to sign, so 9 → 101 can't happen.
- The binding `phoenix_market == strike_market.phoenix_market` plus the per-market seeds limit each call to the book Meridian recorded for that market.
- It doesn't check `config.paused`. Pausing a book is always safe, and must still work when the protocol is paused.

**CPI depth.** Worst case: Meridian (1) → PSM (2) → Phoenix (3) → Phoenix self-CPI log (4). That is inside the 5-level instruction stack limit. The localnet test (§6) must confirm it with the real `.so` files.

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

**New books.** `devnet-bootstrap.cjs` names `book_pauser` as the successor right after `ClaimMarketAuthority`, so no hot pauser ever holds the book. Expected: upgrade key → PSM 6 → `claim_book_pauser`.

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
| Pause timing | Strict `now ≥ expiry_ts`. A few slots of trading can occur between expiry and the pause landing; the keeper sends at the first slot past expiry. | A fixed program constant lead (e.g. 5 s, matching today's `PHOENIX_PAUSE_LEAD_SECS`) so the book is Paused *at* expiry. It's still permissionless and still Paused-only. **Reviewer call.** |
| PDA scope | Per StrikeMarket | One global `[b"book_pauser"]` PDA: simpler bootstrap, but a binding bug would reach every book. |
| Recovery | None at the PSM level, by design. A Meridian **program upgrade** (upgrade authority = multisig on mainnet) is the only way to add new powers. | Keep a cold-storage "recovery" path: re-introduces a key with full powers. |
| Unpause for ops recovery | Not possible after the migration. Ops must create a new market. | An authority-gated `resume_book` valid only **before** expiry: adds an unpause path; not proposed. |

## 6. Test plan (when the program change is built)

1. **Unit / LiteSVM (prod `.so`)**
   - `pause_book` before expiry fails with `ExpiryNotReached`.
   - At or after expiry, Active becomes Paused.
   - Already Paused or Closed: Ok and no-op.
   - Wrong `phoenix_market`, wrong `seat_manager` or wrong PDA: rejected.
   - Any caller works (fresh 0.01-SOL key).
2. **Localnet with the real Phoenix + PSM `.so` files** (opt-in suite, temporary validator on `:8699`):
   - Migrate a book from the hot pauser via 6 + `claim_book_pauser`.
   - The old pauser can no longer call PSM 8 / 6 / 9.
   - `pause_book` pauses at expiry, and CPI depth is OK.
   - A Paused book still allows cancel and withdraw (re-uses the !76 proof).
3. **Negative:** no Meridian instruction can produce PSM 6 / 9 / 11 / evict CPIs with `book_pauser` seeds. Check this with an IDL review plus a test that enumerates instructions.
4. **Ops:**
   - `handoff_repair` targets `book_pauser`.
   - `pause-status --expect-pauser` passes per book.
   - Worker DRY_RUN exits 0 with no pauser key on Railway.

## 7. Follow-ups (not in this change)

- Authority-gated `close_book`: Paused → Closed only, and only after the StrikeMarket is settled. Needed before seat eviction / rent reclaim. TRACKER Todo "Phoenix post-settle `Paused → Closed`".
- An external alert sink for `[pause] ALERT` (today: Railway logs).
