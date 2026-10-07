pub const PRICE_SCALE: u64 = 1_000_000;
pub const CONFIG_SEED: &[u8] = b"config";
#[cfg(feature = "localnet-test")]
pub const SIM_CLOCK_SEED: &[u8] = b"sim_clock";
pub const STRIKE_MARKET_SEED: &[u8] = b"strike_market";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const YES_MINT_SEED: &[u8] = b"yes_mint";
pub const NO_MINT_SEED: &[u8] = b"no_mint";
pub const VAULT_SEED: &[u8] = b"collateral_vault";
pub const EQUITY_SYMBOL_LEN: usize = 8;
pub const DEFAULT_STALENESS_SLOTS: u64 = 150;
pub const DEFAULT_CONF_RATIO_BPS: u16 = 500;
pub const DEFAULT_ADMIN_SETTLE_DELAY_SECS: u64 = 1800;
/// Mock Pyth price account magic (little-endian "MPYT") — localnet-test only.
pub const MOCK_PYTH_MAGIC: u32 = 0x5459_504d;
/// Legacy Pyth on-chain Price account magic (pyth-sdk-solana).
pub const PYTH_PRICE_MAGIC: u32 = 0xa1b2_c3d4;
/// Hard cap on mint/redeem fee bps (10%). Reviewer S2.
pub const MAX_FEE_BPS: u16 = 1_000;
/// Minimum admin_settle_delay_secs on production update_config (localnet-test may use 0).
pub const MIN_ADMIN_SETTLE_DELAY_SECS_PROD: u64 = 60;
/// Timelock between sensitive update_config calls on production builds.
pub const CONFIG_TIMELOCK_SECS: i64 = 3_600;
