use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub market_id: u64,
    pub equity_symbol: [u8; 8],
    pub strike_price_e6: u64,
    pub expiry_ts: i64,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub collateral_vault: Pubkey,
    pub phoenix_market: Pubkey,
    pub pyth_price_feed: Pubkey,
}

#[event]
pub struct Minted {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub collateral_locked: u64,
    pub fee: u64,
    pub pairs_minted_after: u64,
}

#[event]
pub struct Merged {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub pairs_minted_after: u64,
}

#[event]
pub struct Settled {
    pub market: Pubkey,
    pub settlement_price_e6: u64,
    pub strike_price_e6: u64,
    pub outcome_yes: bool,
    pub pyth_conf: u64,
    pub slot: u64,
    pub ts: i64,
}

#[event]
pub struct AdminSettled {
    pub market: Pubkey,
    pub settlement_price_e6: u64,
    pub strike_price_e6: u64,
    pub outcome_yes: bool,
    pub pyth_conf: u64,
    pub slot: u64,
    pub ts: i64,
    pub authority: Pubkey,
}

#[event]
pub struct Redeemed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub collateral_paid: u64,
    pub fee: u64,
    pub pairs_redeemed_after: u64,
}

#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub paused: bool,
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub settle_max_staleness_slots: u64,
    pub settle_max_conf_ratio_bps: u16,
    pub admin_settle_delay_secs: u64,
}

#[event]
pub struct PhoenixMarketSet {
    pub market: Pubkey,
    pub phoenix_market: Pubkey,
    pub phoenix_base_mint: Pubkey,
    pub phoenix_quote_mint: Pubkey,
}

#[cfg(feature = "localnet-test")]
#[event]
pub struct SimClockSet {
    pub unix_timestamp: i64,
    pub slot: u64,
    pub authority: Pubkey,
}
