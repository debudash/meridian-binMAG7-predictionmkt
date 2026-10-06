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
pub const YES_MINT_AUTH_SEED: &[u8] = b"yes_mint_authority";
pub const NO_MINT_AUTH_SEED: &[u8] = b"no_mint_authority";

pub const EQUITY_SYMBOL_LEN: usize = 8;
```

### `MarketStatus` (`u8`)

| Value | Name | Meaning |
| ---: | --- | --- |
| 0 | `Open` | Mint + trade allowed (subject to pause / expiry) |
| 1 | `Settling` | Optional intermediate (automation); treat like Open for reads |
| 2 | `SettledYes` | Yes redeems 1:1 USDC |
| 3 | `SettledNo` | No redeems 1:1 USDC |
| 4 | `Void` | Admin cancelled; redeem policy TBD (default: refund pro-rata — **out of v1 scope**, avoid Void unless specified) |

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
    pub reserved: [u8; 48],                // 48
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
    pub yes_mint_auth_bump: u8,            // 1
    pub no_mint_auth_bump: u8,             // 1
    pub reserved: [u8; 32],                // 32
}
```

### Field notes

| Field | Constraints |
| --- | --- |
| `equity_symbol` | Uppercase ASCII MAG7 ticker, space-padded to 8 |
| `strike_price_e6` | `> 0`; product automation rounds to $10 ticks then × 1e6 |
| `expiry_ts` | Target cash-close instant (ET); settle allowed at/after |
| `phoenix_market` | May be `Pubkey::default()` until `set_phoenix_market` |
| `phoenix_base_mint` | Assert `== yes_mint` when set (default wiring) |
| `phoenix_quote_mint` | Assert `== config.collateral_mint` |
| `pairs_redeemed` | Never exceeds winning supply redeemed; track carefully if burn_losing exists |
| `settlement_price_e6` | `0` until settled; then Pyth-converted or admin-provided |

### Status machine

```text
Open ──settle / admin_settle──► SettledYes
  │                         └► SettledNo
  └── (optional) Settling ──► SettledYes | SettledNo
```

No transitions out of settled states.

### Writers

| Instruction | Fields touched |
| --- | --- |
| `create_strike_market` | all initial |
| `mint` | `pairs_minted` |
| `settle` / `admin_settle` | status, settlement_*, settled_* |
| `redeem` | `pairs_redeemed` |
| `set_phoenix_market` | phoenix_* |

---

## Vault authority PDA

**Seeds:** `[VAULT_AUTHORITY_SEED, strike_market.key()]`

**Role:** `authority` of `collateral_vault` token account. Signs CPI transfers on redeem (and fee skim if any).

Does not hold SOL beyond rent if used only as signer PDA (no data account required — seeds + bump on `StrikeMarket.vault_bump`).

### Collateral vault token account

| Property | Value |
| --- | --- |
| Mint | `Config.collateral_mint` |
| Authority | vault authority PDA |
| Close authority | none (or program) |
| Address | Prefer ATA(`vault_authority`, `collateral_mint`) or init with deterministic seeds `["collateral_vault", strike_market]` |

**Default address seeds (explicit token account, not ATA):**

```text
["collateral_vault", strike_market.key()]
```

Store resulting pubkey in `StrikeMarket.collateral_vault`.

---

## Yes / No mints

Created with `token::Mint` init in `create_strike_market`.

| Property | Yes | No |
| --- | --- | --- |
| Decimals | `config.collateral_decimals` | same |
| Mint authority | PDA `[YES_MINT_AUTH_SEED, strike_market]` | PDA `[NO_MINT_AUTH_SEED, strike_market]` |
| Freeze authority | `None` | `None` |
| Supply at create | `0` | `0` |

After `Settled*`, mint authority CPIs should refuse further `mint` (status check). Optional: revoke mint authority on settle for stronger immutability (not required if ix gates hold).

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

Recalculate from `InitSpace` after final struct edits; keep `reserved` for additive fields without migration where possible.

---

## Serialization / IDL notes

- Expose `MarketStatus` as an Anchor `enum` in IDL even if stored as `u8`.
- Emit `equity_symbol` as bytes; clients trim spaces.
- Never store Pyth price inside `StrikeMarket` except the final `settlement_price_e6`.
