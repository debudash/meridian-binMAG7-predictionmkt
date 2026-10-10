# Meridian Account Specs

Expanded field specifications for Anchor accounts. Canonical summary lives in [`SCHEMA.md`](SCHEMA.md).

Rust-ish types throughout. All `#[account]` structs begin with the 8-byte Anchor discriminator at runtime; space calculations below **include** discriminator unless noted.

---

## Constants

```rust
pub const PRICE_SCALE: u64 = 1_000_000; // 1e6 — strike, settlement, display Yes price
pub const CONFIG_SEED: &[u8] = b"config";
pub const STRIKE_MARKET_SEED: &[u8] = b"strike_market";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const YES_MINT_SEED: &[u8] = b"yes_mint";
pub const NO_MINT_SEED: &[u8] = b"no_mint";
pub const VAULT_SEED: &[u8] = b"collateral_vault";
pub const SIM_CLOCK_SEED: &[u8] = b"sim_clock"; // localnet-test only (D-017)

pub const EQUITY_SYMBOL_LEN: usize = 8;
```

### `MarketStatus` (`u8`)

| Value | Name | Meaning |
| ---: | --- | --- |
| 0 | `Open` | Pre-settle. Mint window also requires `!paused && effective_now < expiry_ts`. **`merge_pair`** allowed whenever `Open && !paused` (including after expiry). Settle/admin_settle target this status only |
| 1 | `Settling` | **Unused / reserved (X-07).** Do not transition into or accept. Kept for Borsh/IDL numeric stability |
| 2 | `SettledYes` | Yes redeems 1:1 USDC |
| 3 | `SettledNo` | No redeems 1:1 USDC |
| 4 | `Void` | Admin cancelled; redeem policy TBD (default: refund pro-rata — **out of v1 scope**, avoid Void unless specified) |

**State machine (locked):** `Open` → `SettledYes` | `SettledNo` | `Void` only. No `Settling` intermediate.

**Open vs mint window:** There is **no** separate status for exchange session open/close. `status == Open` after `expiry_ts` still means "not yet settled" — mint is blocked by the time gate, not by a new enum variant; **`merge_pair` remains allowed**. Meridian "market open" (mint) = `Open && !paused && effective_now < expiry_ts`. "Market close" (mint ends) = `effective_now >= expiry_ts`. See [`sim-clock.md`](sim-clock.md) (D-017) and **D-018** (`merge_pair`).

---

## `Config`

**Seeds:** `[CONFIG_SEED]` → unique global.

**Init space (recommended):** `8 + 192` = `256` bytes allocated.

```rust
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,                 // 32
    pub collateral_mint: Pubkey,           // 32
    pub collateral_decimals: u8,           // 1
    pub treasury: Pubkey,                  // 32
    pub mint_fee_bps: u16,                 // 2
    pub redeem_fee_bps: u16,               // 2
    pub paused: bool,                      // 1
    pub settle_max_staleness_slots: u64,   // 8
    pub settle_max_conf_ratio_bps: u16,    // 2
    pub admin_settle_delay_secs: u64,      // 8
    pub next_market_id: u64,               // 8 — optional counter for indexer-friendly ids
    pub bump: u8,                          // 1
    pub last_config_update_ts: i64,        // 8 — prod timelock between sensitive update_config calls
    pub reserved: [u8; 40],                // 40
}
```

### Field notes

| Field | Constraints |
| --- | --- |
| `authority` | Must sign pause / update / admin_settle / create_strike_market |
| `collateral_mint` | Immutable after init (v1); changing mint would orphan vaults |
| `collateral_decimals` | Assert `== 6` at init for USDC |
| `treasury` | ATA of authority or dedicated fee PDA; must accept `collateral_mint` |
| `mint_fee_bps` / `redeem_fee_bps` | `0..=10_000`; demo default `0` |
| `settle_max_staleness_slots` | Default `150` |
| `settle_max_conf_ratio_bps` | Default `500` (5%) |
| `admin_settle_delay_secs` | Default `1800` (30 minutes after expiry) |
| `next_market_id` | Incremented on each `create_strike_market` |

### Writers

| Instruction | Fields touched |
| --- | --- |
| `initialize_config` | all |
| `update_config` | fees, staleness, conf, delay, treasury (not mint) |
| `pause` / `unpause` | `paused` |
| `create_strike_market` | `next_market_id` |

---

## `StrikeMarket`

**Seeds (default):**

```text
[STRIKE_MARKET_SEED, equity_symbol, expiry_ts_le_bytes, strike_price_e6_le_bytes]
```

`expiry_ts` and `strike_price_e6` are little-endian `i64` / `u64` byte arrays (8 bytes each).

**Init space (recommended):** `8 + 376` ≈ allocate `400` or derive via `InitSpace`.

```rust
#[account]
#[derive(InitSpace)]
pub struct StrikeMarket {
    pub config: Pubkey,                    // 32
    pub market_id: u64,                    // 8
    pub equity_symbol: [u8; 8],            // 8
    pub pyth_price_feed: Pubkey,           // 32
    pub pyth_feed_id: [u8; 32],            // 32
    pub strike_price_e6: u64,              // 8
    pub expiry_ts: i64,                    // 8
    pub yes_mint: Pubkey,                  // 32
    pub no_mint: Pubkey,                   // 32
    pub collateral_vault: Pubkey,          // 32
    pub phoenix_market: Pubkey,            // 32
    pub phoenix_base_mint: Pubkey,         // 32
    pub phoenix_quote_mint: Pubkey,        // 32
    pub status: u8,                        // 1
    pub pairs_minted: u64,                 // 8
    pub pairs_redeemed: u64,               // 8
    pub settlement_price_e6: u64,          // 8
    pub settled_at_ts: i64,                // 8
    pub settled_slot: u64,                 // 8
    pub bump: u8,                          // 1
    pub vault_bump: u8,                    // 1
    pub trading_open: bool,                // 1 — localnet sim window (D-017); true on create
    pub sim_armed: bool,                   // 1 — set by sim_open_session; then settle requires !trading_open
    pub reserved: [u8; 62],                // 62
}
```

### Field notes

| Field | Constraints |
| --- | --- |
| `equity_symbol` | Uppercase ASCII MAG7 ticker, space-padded to 8 |
| `strike_price_e6` | `> 0`; automation rounds the reference price to `STRIKE_STEP_E6` (default $5 at ≥ $100, else $1), adds `STRIKE_OFFSETS_E6`, then × 1e6 ([`apps/automation/README.md`](../apps/automation/README.md)) |
| `expiry_ts` | Target cash-close instant (ET); settle allowed at/after |
| `phoenix_market` | May be `Pubkey::default()` until `set_phoenix_market` |
| `phoenix_base_mint` | Assert `== yes_mint` when set (default wiring) |
| `phoenix_quote_mint` | Assert `== config.collateral_mint` |
| `pairs_minted` | While Open: **outstanding pair liability** (+`mint` / −`merge_pair`). Equals Yes supply (= No supply). After settle: frozen; redeem increments `pairs_redeemed` only |
| `pairs_redeemed` | Never exceeds winning supply redeemed; track carefully if burn_losing exists |
| `settlement_price_e6` | `0` until settled; then Pyth-converted or admin-provided |
| `settled_at_ts` / `settled_slot` | Record **effective_clock** values at settle (wall or SimClock under localnet-test) |

### Status machine

```text
Open ──settle / admin_settle──► SettledYes
  │                         └► SettledNo
  └── (admin) Void

Settling (1) = unused / reserved — never entered
```

No transitions out of settled / void states.

### Writers

| Instruction | Fields touched |
| --- | --- |
| `create_strike_market` | all initial |
| `mint` | `pairs_minted` (+) |
| `merge_pair` | `pairs_minted` (−) |
| `settle` / `admin_settle` | status, settlement_*, settled_* |
| `redeem` | `pairs_redeemed` |
| `set_phoenix_market` | phoenix_* |

---

## Vault authority PDA

**Seeds:** `[VAULT_AUTHORITY_SEED, strike_market.key()]`

**Role:** `authority` of `collateral_vault` token account. Signs CPI transfers on redeem / **merge_pair** (and fee skim if any).

Does not hold SOL beyond rent if used only as signer PDA (no data account required — seeds + bump on `StrikeMarket.vault_bump`).

### Collateral vault token account

| Property | Value |
| --- | --- |
| Mint | `Config.collateral_mint` |
| Authority | vault authority PDA |
| Close authority | none (or program) |
| Address | Token account PDA with seeds `[VAULT_SEED, strike_market]` = `["collateral_vault", strike_market]` (not an ATA) |

**Default address seeds (explicit token account, not ATA):**

```text
["collateral_vault", strike_market.key()]
```

Store resulting pubkey in `StrikeMarket.collateral_vault`.

---

## Yes / No mints

Created with `token::Mint` init in `create_strike_market`, at PDAs `[YES_MINT_SEED, strike_market]` / `[NO_MINT_SEED, strike_market]`.

| Property | Yes | No |
| --- | --- | --- |
| Decimals | `config.collateral_decimals` | same |
| Mint authority | vault authority PDA `[VAULT_AUTHORITY_SEED, strike_market]` | same |
| Freeze authority | `None` | `None` |
| Supply at create | `0` | `0` |

After `Settled*`, mint authority CPIs should refuse further `mint` (status check). Optional: revoke mint authority on settle for stronger immutability (not required if ix gates hold).

---

## `SimClock` (localnet-test only — D-017)

**Seeds:** `[SIM_CLOCK_SEED]` → `["sim_clock"]` (unique global).

**Feature gate:** type + writers compile only under `localnet-test`. Prod builds omit this account from the IDL.

**Init space (recommended):** `8 + 50` → **64** bytes allocated.

```rust
#[cfg(feature = "localnet-test")]
#[account]
#[derive(InitSpace)]
pub struct SimClock {
    pub authority: Pubkey,       // 32 — == Config.authority
    pub unix_timestamp: i64,     // 8
    pub slot: u64,               // 8
    pub enabled: bool,           // 1
    pub bump: u8,                // 1
}
```

### Field notes

| Field | Constraints |
| --- | --- |
| `authority` | Must match `Config.authority`; signs all sim mutators |
| `unix_timestamp` | Feeds mint / settle / admin_settle time gates via `effective_clock` |
| `slot` | Feeds Pyth staleness `slot_now` under sim |
| `enabled` | `false` → `effective_clock` falls back to `Clock::get()` |

### Writers

| Instruction | Fields touched |
| --- | --- |
| `init_sim_clock` | all; seed ts/slot from wall clock once; `enabled = true` |
| `set_sim_clock` | `unix_timestamp`, `slot` |
| `warp_sim_clock` | `unix_timestamp`, `slot` (add) |
| `disable_sim_clock` | `enabled = false` |

Full proposal + fixture recipe: [`sim-clock.md`](sim-clock.md).

---

## External accounts (not Meridian-owned)

| Account | Owner | Usage |
| --- | --- | --- |
| Phoenix market | Phoenix program | Matching Yes↔USDC; pubkey stored only |
| Phoenix trader / seat | Phoenix program | User trading; not in Meridian state |
| Pyth price account | Pyth | Read at settle; validate feed id + staleness + conf |
| User ATAs | Token program | Collateral, Yes, No |
| USDC mint | Token / Token-2022 | Config.collateral_mint |

---

## Account size checklist (for `#[account(init, space = ...)]`)

| Account | Suggested `space` |
| --- | --- |
| `Config` | `8 + 192` → **256** |
| `StrikeMarket` | `8 + 376` → **400** |
| `SimClock` (`localnet-test`) | `8 + 50` → **64** |

Recalculate from `InitSpace` after final struct edits; keep `reserved` for additive fields without migration where possible.

---

## Serialization / IDL notes

- Expose `MarketStatus` as an Anchor `enum` in IDL even if stored as `u8`.
- Emit `equity_symbol` as bytes; clients trim spaces.
- Never store Pyth price inside `StrikeMarket` except the final `settlement_price_e6`.
- `SimClock` and `SimClockSet` appear in the IDL **only** when built with `localnet-test`; prod IDL must not list them.
