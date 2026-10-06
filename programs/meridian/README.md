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
    │   └── strike_market.rs   # StrikeMarket + MarketStatus
    ├── instructions/
    │   ├── mod.rs
    │   ├── initialize_config.rs
    │   ├── update_config.rs
    │   ├── pause.rs           # pause + unpause
    │   ├── create_strike_market.rs
    │   ├── set_phoenix_market.rs
    │   ├── mint.rs
    │   ├── settle.rs
    │   ├── admin_settle.rs
    │   ├── redeem.rs
    │   └── burn_losing.rs     # optional v1
    ├── events.rs              # MarketCreated, Minted, Settled, AdminSettled, Redeemed, ConfigUpdated, PhoenixMarketSet
    ├── errors.rs              # MeridianError
    ├── constants.rs           # seeds, PRICE_SCALE, defaults
    └── utils/
        ├── mod.rs
        ├── pyth.rs            # staleness, conf ratio, pyth_price_to_e6
        └── token.rs           # mint/burn/transfer helpers with PDA signers
```

## `state`

| Module | Types |
| --- | --- |
| `config` | `Config` |
| `strike_market` | `StrikeMarket`, `MarketStatus` |

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
}
```

**Not in scope:** Phoenix place/cancel/fill — users call Phoenix program directly.

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

## Docs

| Doc | Use |
| --- | --- |
| [`docs/SCHEMA.md`](../../docs/SCHEMA.md) | Implement structs + ix sketches |
| [`docs/accounts.md`](../../docs/accounts.md) | Exact fields / seeds |
| [`docs/flows.md`](../../docs/flows.md) | CPI order / UX |
| [`docs/units.md`](../../docs/units.md) | Fixed-point + Pyth math |

## Feature flags (deploy blockers)

| Feature | Purpose |
| --- | --- |
| *(none / default)* | Production binary — **no** `upsert_mock_pyth` / `test_drain_vault` |
| `localnet-test` | Local validator + `anchor test` only — fixture ixs for Pyth mocks + V-07 vault drain |

```bash
# Localnet / CI suite
anchor build -- --features localnet-test
anchor test -- --features localnet-test

# Production / mainnet deploy (fixtures absent from .so)
anchor build
```

Authority-only checks are **not** sufficient for deploy safety — these ixs are `#[cfg(feature = "localnet-test")]`.

