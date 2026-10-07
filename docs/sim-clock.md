# SimClock — localnet time simulation (D-017)

**Status:** locked as **D-017**  
**Audience:** Meridian Engineers / Testers  
**Goal:** Simulate Meridian mint-window open/close and settle gates **without waiting on real wall-clock hours** during localnet test/validation.

Companion: [`SCHEMA.md`](SCHEMA.md) · [`accounts.md`](accounts.md) · [`flows.md`](flows.md) · [`../programs/meridian/README.md`](../programs/meridian/README.md)

---

## Non-goals

| Non-goal | Why |
| --- | --- |
| New `StrikeMarket` status for session open/close | Lifecycle stays `Open` → `SettledYes \| SettledNo \| Void`. Session hours are **not** a Meridian status. |
| Meridian "session hours" account / calendar | Phoenix trading hours are out of Meridian. No Meridian session-hours PDA. |
| Prod Config bool / SimClock fields on Config | Keep Config layout impact **zero**. Sim is feature + separate PDA only. |
| Compile sim ixs into production `.so` | Same deploy-blocker pattern as `upsert_mock_pyth` / `test_drain_vault` — `#[cfg(feature = "localnet-test")]` only. |
| Replace pause semantics | Pause stays orthogonal: blocks mint/create only; settle+redeem still allowed. |

---

## Product vocabulary (Meridian, not Phoenix)

| Phrase | On-chain meaning |
| --- | --- |
| **Market open** (mint window) | `status == Open && !paused && effective_now < expiry_ts` |
| **Market close** (mint window ends) | `effective_now >= expiry_ts` (status may still be `Open` until settle) |
| **Settled** | `status ∈ {SettledYes, SettledNo, Void}` |
| Phoenix trading session | **Out of scope** — Phoenix CLOB; Meridian does not gate Phoenix hours |

---

## Account: `SimClock` PDA

**Feature gate:** account type + ixs exist only under `localnet-test`. Prod builds never include SimClock in the IDL.

**PDA seeds:**

```text
["sim_clock"]
```

```rust
#[cfg(feature = "localnet-test")]
#[account]
#[derive(InitSpace)]
pub struct SimClock {
    pub authority: Pubkey,      // 32 — must == Config.authority
    pub unix_timestamp: i64,    // 8  — simulated Clock.unix_timestamp
    pub slot: u64,              // 8  — simulated Clock.slot (Pyth staleness under sim)
    pub enabled: bool,          // 1  — if false, fall back to Clock::get()
    pub bump: u8,               // 1
}
```

**Approx space:** `8` (disc) + `32+8+8+1+1` = `58` → allocate `64` or `InitSpace`.

| Field | Notes |
| --- | --- |
| `authority` | Prefer **`Config.authority`** (not Config PDA). All mutators require signer == this pubkey and == `config.authority`. |
| `unix_timestamp` | Used for mint (`< expiry_ts`), settle (`>= expiry_ts`), admin_settle (`>= expiry_ts + admin_settle_delay_secs`). |
| `slot` | Used for Pyth staleness: `slot_now - pyth_publish_slot <= settle_max_staleness_slots`. |
| `enabled` | `true` after `init_sim_clock`; `disable_sim_clock` sets `false` → `effective_clock` uses `Clock::get()`. |

**Writers:** `init_sim_clock`, `set_sim_clock`, `warp_sim_clock`, `disable_sim_clock` (all authority + `localnet-test` only).

---

## Instructions (`#[cfg(feature = "localnet-test")]`)

Same deploy-blocker pattern as mock Pyth / `test_drain_vault`: absent from prod `.so` and prod IDL.

### `init_sim_clock`

**Accounts:** `authority` (signer, == `config.authority`), `config`, `sim_clock` (PDA init `["sim_clock"]`), `system_program`.

**Behavior:**

1. Create PDA; set `authority = config.authority`.
2. Seed `unix_timestamp` / `slot` from wall `Clock::get()` once.
3. `enabled = true`.

**Event:** `SimClockSet { unix_timestamp, slot, authority }`.

### `set_sim_clock`

**Args:** `unix_timestamp: i64`, `slot: u64`.

**Accounts:** `authority` (signer), `config`, `sim_clock`.

**Checks:** `sim_clock.enabled`; signer == `sim_clock.authority` == `config.authority`.

**Behavior:** overwrite `unix_timestamp` and `slot`; emit `SimClockSet`.

### `warp_sim_clock`

**Args:** `add_secs: i64`, `add_slots: u64`.

**Accounts:** same as `set_sim_clock`.

**Checks:** `enabled`; authority match.

**Behavior:**

```text
unix_timestamp = unix_timestamp.saturating_add(add_secs)   // or checked_add → MathOverflow
slot           = slot.saturating_add(add_slots)
```

Prefer **saturating** for warp (tests should not panic on overflow); document if Engineers choose `checked_*` + `MeridianError::MathOverflow` instead — either is fine if consistent.

Emit `SimClockSet` with post-warp values.

### `disable_sim_clock` (optional but recommended)

**Accounts:** authority, config, sim_clock.

**Behavior:** `enabled = false`. Subsequent time gates use `Clock::get()`. Does not close the account (cheap re-enable via `set_sim_clock` after a future `enable` if added; v1 may re-`init` only once — prefer keep account and flip `enabled`).

---

## `effective_clock` helper

Used by **every** time gate: `mint`, `settle`, `admin_settle`, and any future ix that reads now/slot for gates. Also feeds Pyth staleness `slot_now`.

```rust
pub struct EffectiveClock {
    pub unix_timestamp: i64,
    pub slot: u64,
}

/// Production builds: body is only Clock::get() — no SimClock types compiled in.
pub fn effective_clock(
    #[cfg(feature = "localnet-test")] sim: &Option<Account<SimClock>>,
) -> Result<EffectiveClock> {
    #[cfg(feature = "localnet-test")]
    {
        if let Some(sim) = sim {
            if sim.enabled {
                return Ok(EffectiveClock {
                    unix_timestamp: sim.unix_timestamp,
                    slot: sim.slot,
                });
            }
        }
    }
    let c = Clock::get()?;
    Ok(EffectiveClock {
        unix_timestamp: c.unix_timestamp,
        slot: c.slot,
    })
}
```

| Build | Behavior |
| --- | --- |
| **Prod** (`anchor build`) | No sim ixs; time-gated ixs call `Clock::get()` only. No SimClock account in IDL. |
| **Localnet** (`--features localnet-test`) | If SimClock present **and** `enabled` → use sim ts/slot; else wall clock. |

### Recording settle timestamps

`settled_at_ts` / `settled_slot` on `StrikeMarket` **must** record the **effective** clock values used at settle (not wall clock). Makes fixtures deterministic under warp.

---

## Preferred Anchor account shape (Engineers)

**Pick: optional account on time-gated contexts under `localnet-test`.**

```rust
#[derive(Accounts)]
pub struct MintPair<'info> {
    // ... existing accounts ...
    pub config: Account<'info, Config>,
    pub strike_market: Account<'info, StrikeMarket>,
    // ...

    /// CHECK: only read when feature + enabled; PDA seeds ["sim_clock"]
    #[cfg(feature = "localnet-test")]
    pub sim_clock: Option<Account<'info, SimClock>>,
}
```

Same pattern on `Settle` and `AdminSettle`.

| Option | Verdict |
| --- | --- |
| `Option<Account<SimClock>>` under `localnet-test` | **Preferred** — tests that never init sim omit the account; wall clock used. |
| Always-present PDA that tests must `init_sim_clock` first | Acceptable alternative; slightly more harness boilerplate. |
| Remaining-accounts `UncheckedAccount` scan | Discouraged — easier to mis-wire; prefer typed optional account. |

**Prod contexts:** do **not** add `sim_clock` to account structs (cfg strips it). No Config field.

**Pause:** unchanged — does not consult `effective_clock`. Mint still requires `!paused` **and** `effective_now < expiry_ts`.

---

## Fixture recipe (localnet)

Replace today's `expiry = now+2` + `waitPastExpiry()` sleep pattern for realistic close-window tests.

1. **`init_sim_clock`** once per validator (authority).
2. **Create market** with realistic `expiry_ts` (e.g. intended 16:00 America/New_York unix for that fixture day) — not `now+2`.
3. **Mint while open:** ensure sim `unix_timestamp < expiry_ts` (set/warp as needed); call `mint`.
4. **Close mint window:** `warp_sim_clock` so `unix_timestamp >= expiry_ts` (and bump `slot` enough for any slot-based asserts).
5. **Mock Pyth:** `upsert_mock_pyth` with `publish_slot` near **sim** `slot` (within `settle_max_staleness_slots`).
6. **`settle`** — should succeed without wall sleep; writes `settled_at_ts` / `settled_slot` from effective clock.
7. **Admin settle path:** keep `admin_settle_delay_secs = 1800` (default). Warp so  
   `effective_now >= expiry_ts + 1800` — **no need to zero the delay** for happy-path speed.

### Suggested P0 cases (Testers)

| ID | Case |
| --- | --- |
| SC-01 | Warp past `expiry_ts` → `settle` succeeds (no wall sleep) |
| SC-02 | After warp past expiry → `mint` fails (`MintAfterExpiry`) |
| SC-03 | `admin_settle` with delay=`1800` succeeds after warp past `expiry + 1800` (no wall sleep) |

---

## Events

```rust
#[cfg(feature = "localnet-test")]
#[event]
pub struct SimClockSet {
    pub unix_timestamp: i64,
    pub slot: u64,
    pub authority: Pubkey,
}
```

Emitted by `init_sim_clock`, `set_sim_clock`, `warp_sim_clock`.

---

## Consistency matrix

| Gate | Clock source | Pause interaction |
| --- | --- | --- |
| `mint`: `now < expiry_ts` | `effective_clock` | Also requires `!paused` |
| `settle`: `now >= expiry_ts` | `effective_clock` | Pause **ignored** (settle allowed) |
| `admin_settle`: `now >= expiry_ts + delay` | `effective_clock` | Pause ignored |
| Pyth staleness `slot_now` | `effective_clock.slot` | n/a |
| `settled_at_ts` / `settled_slot` | effective values at settle | n/a |

---

## Implementation checklist (Engineers)

1. Add `localnet-test`-gated `state/sim_clock.rs` + PDA seed constant `b"sim_clock"`.
2. Add ixs: `init_sim_clock`, `set_sim_clock`, `warp_sim_clock`, optional `disable_sim_clock`.
3. Add `utils/clock.rs` → `effective_clock`; switch mint / settle / admin_settle (and Pyth slot_now) to it.
4. Under `localnet-test`, add `sim_clock: Option<Account<SimClock>>` to Mint / Settle / AdminSettle contexts.
5. Emit `SimClockSet`; keep prod `anchor build` free of sim symbols (same verification as mock Pyth).
6. Harness: helpers `initSimClock` / `warpSimClock` / `setSimClock`; retire sleep-based `waitPastExpiry` where SC-* covers the path.
