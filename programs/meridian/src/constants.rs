pub const PRICE_SCALE: u64 = 1_000_000;
pub const CONFIG_SEED: &[u8] = b"config";
pub const STRIKE_MARKET_SEED: &[u8] = b"strike_market";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const YES_MINT_SEED: &[u8] = b"yes_mint";
pub const NO_MINT_SEED: &[u8] = b"no_mint";
pub const VAULT_SEED: &[u8] = b"collateral_vault";
pub const EQUITY_SYMBOL_LEN: usize = 8;
pub const DEFAULT_STALENESS_SLOTS: u64 = 150;
pub const DEFAULT_CONF_RATIO_BPS: u16 = 500;
pub const DEFAULT_ADMIN_SETTLE_DELAY_SECS: u64 = 1800;
/// Mock Pyth price account magic (little-endian "MPYT")
pub const MOCK_PYTH_MAGIC: u32 = 0x5459_504d;
