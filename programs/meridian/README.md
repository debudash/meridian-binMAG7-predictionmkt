# `programs/meridian` — Anchor module map

Scaffold target for Engineers. This repo slice documents schema only; wire crates to match [`docs/SCHEMA.md`](../../docs/SCHEMA.md).

**Program name:** `meridian`  
**Forge:** Gauntlet Labs GitLab `debudash/peak6-meridian` (private)

```text
programs/meridian/
├── Cargo.toml
├── Xargo.toml                 # if needed for BPF
└── src/
    ├── lib.rs                 # declare_id!; module exports; #[program] entrypoints
    ├── state/
    │   ├── mod.rs
    │   ├── config.rs          # Config
    │   ├── strike_market.rs   # StrikeMarket + MarketStatus
    │   └── sim_clock.rs       # SimClock — localnet-test only (D-017)
    ├── instructions/
    │   ├── mod.rs
    │   ├── initialize_config.rs
    │   ├── update_config.rs
    │   ├── pause.rs           # pause + unpause
    │   ├── create_strike_market.rs
    │   ├── set_phoenix_market.rs
    │   ├── mint.rs            # uses effective_clock
    │   ├── settle.rs          # uses effective_clock
    │   ├── admin_settle.rs    # uses effective_clock
    │   ├── redeem.rs
    │   ├── burn_losing.rs     # optional v1
    │   ├── init_sim_clock.rs  # localnet-test only
    │   ├── set_sim_clock.rs   # localnet-test only
    │   ├── warp_sim_clock.rs  # localnet-test only
    │   └── disable_sim_clock.rs  # localnet-test only (optional)
    ├── events.rs              # + SimClockSet (cfg localnet-test)
    ├── errors.rs              # MeridianError
    ├── constants.rs           # seeds, PRICE_SCALE, defaults
    └── utils/
        ├── mod.rs
        ├── clock.rs           # effective_clock helper (D-017)
        ├── pyth.rs            # staleness, conf ratio, pyth_price_to_e6
        └── token.rs           # mint/burn/transfer helpers with PDA signers
```

## `state`

| Module | Types |
| --- | --- |
| `config` | `Config` |
| `strike_market` | `StrikeMarket`, `MarketStatus` |
| `sim_clock` | `SimClock` (`localnet-test` only) |

PDA seeds and field tables: [`docs/accounts.md`](../../docs/accounts.md).

## `instructions` (entrypoint sketch)

```rust
#[program]
pub mod meridian {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, params: InitConfigParams) -> Result<()> { … }
    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> { … }
    pub fn pause(ctx: Context<Pause>) -> Result<()> { … }
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> { … }

    pub fn create_strike_market(ctx: Context<CreateStrikeMarket>, params: CreateStrikeParams) -> Result<()> { … }
    pub fn set_phoenix_market(ctx: Context<SetPhoenixMarket>, phoenix_market: Pubkey) -> Result<()> { … }

    pub fn mint(ctx: Context<MintPair>, amount: u64) -> Result<()> { … }
    pub fn settle(ctx: Context<Settle>) -> Result<()> { … }
    pub fn admin_settle(ctx: Context<AdminSettle>, settlement_price_e6: u64, outcome_yes: bool) -> Result<()> { … }
    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> { … }
    pub fn burn_losing(ctx: Context<BurnLosing>, amount: u64) -> Result<()> { … }

    // localnet-test only — same deploy-blocker pattern as upsert_mock_pyth
    #[cfg(feature = "localnet-test")]
    pub fn init_sim_clock(ctx: Context<InitSimClock>) -> Result<()> { … }
    #[cfg(feature = "localnet-test")]
    pub fn set_sim_clock(ctx: Context<SetSimClock>, unix_timestamp: i64, slot: u64) -> Result<()> { … }
    #[cfg(feature = "localnet-test")]
    pub fn warp_sim_clock(ctx: Context<WarpSimClock>, add_secs: i64, add_slots: u64) -> Result<()> { … }
    #[cfg(feature = "localnet-test")]
    pub fn disable_sim_clock(ctx: Context<DisableSimClock>) -> Result<()> { … }
}
```

**Not in scope:** Phoenix place/cancel/fill — users call Phoenix program directly.

**Engineers:** implement SimClock + `effective_clock` behind `localnet-test` exactly like mock Pyth / `test_drain_vault` — prod `anchor build` must omit sim symbols from the `.so`. See [`docs/sim-clock.md`](../../docs/sim-clock.md) (D-017).

## `errors` (suggested)

| Code name | When |
| --- | --- |
| `Paused` | mint / create while paused |
| `MarketNotOpen` | mint on non-Open |
| `MarketNotSettled` | redeem before settle |
| `ExpiryNotReached` | settle too early |
| `MintAfterExpiry` | mint at/after expiry |
| `InvalidPythAccount` | feed mismatch |
| `StalePythPrice` | staleness gate |
| `PythConfidenceTooWide` | conf ratio gate |
| `InvalidPythPrice` | non-positive / zero e6 |
| `MathOverflow` | scale convert / fee math |
| `InvalidWinningMint` | redeem wrong side |
| `AdminSettleTooEarly` | delay not elapsed |
| `Unauthorized` | authority mismatch |
| `InvalidPhoenixMints` | base/quote ≠ Yes/USDC |
| `InsufficientVault` | should not happen if invariants hold |

## `events`

Defined in [`docs/SCHEMA.md`](../../docs/SCHEMA.md) §6. Keep field order stable for indexers.

## Dependencies (expected)

- `anchor-lang`, `anchor-spl`
- Pyth Solana receiver / price-account crate compatible with chosen Pyth version (pin in Cargo.toml at implement time)
- **No** Phoenix matching dependency required inside Meridian for v1 (pubkey + mint asserts only). Optional: Phoenix SDK types for off-chain automation only.

## Test plan (scaffold)

1. Unit: `pyth_price_to_e6` vectors in [`docs/units.md`](../../docs/units.md)
2. Integration: mint → settle (≥ / < strike) → redeem; fee=0 path
3. Negative: stale Pyth, pause blocks mint, admin_settle before delay
4. Invariant: vault balance vs `pairs_minted - pairs_redeemed`
5. SimClock (localnet): SC-01 warp past expiry → settle; SC-02 mint fails after warp; SC-03 admin_settle delay=1800 after warp (no wall sleep)

## Docs

| Doc | Use |
| --- | --- |
| [`docs/SCHEMA.md`](../../docs/SCHEMA.md) | Implement structs + ix sketches |
| [`docs/accounts.md`](../../docs/accounts.md) | Exact fields / seeds |
| [`docs/flows.md`](../../docs/flows.md) | CPI order / UX |
| [`docs/units.md`](../../docs/units.md) | Fixed-point + Pyth math |
| [`docs/sim-clock.md`](../../docs/sim-clock.md) | SimClock / effective_clock (D-017) |

## Feature flags (deploy blockers)

| Feature | Purpose |
| --- | --- |
| *(none / default)* | Production binary — **no** `upsert_mock_pyth` / `test_drain_vault` / SimClock / `sim_*` |
| `localnet-test` | Local validator + `anchor test` only — mock Pyth, V-07 drain, **SimClock** (`init` / `set` / `warp` / `disable`), D-017 `sim_open_session` / `sim_close_session` |

```bash
# Localnet / CI suite
anchor build -- --features localnet-test
anchor test -- --features localnet-test

# Production / mainnet deploy (fixtures absent from .so)
anchor build
```

Authority-only checks are **not** sufficient for deploy safety — these ixs are `#[cfg(feature = "localnet-test")]`.

## Deploy rule (Reviewer / D-017)

**FORBIDDEN on devnet staging and mainnet:** `anchor build -- --features localnet-test` or `yarn build:localnet`.

Production deploy path: `yarn build:prod` (no features) → assert `.so` / `idl/meridian.prod.json` contain no fixture ix names (`upsert_mock_pyth`, `test_drain_vault`, `sim_*`, `sim_clock`).

See [`docs/DEPLOY.md`](../../docs/DEPLOY.md) for the full Railway / cluster ladder.

