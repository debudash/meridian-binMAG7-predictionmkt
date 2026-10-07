use anchor_lang::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq, AnchorSerialize, AnchorDeserialize, InitSpace)]
#[repr(u8)]
pub enum MarketStatus {
    Open = 0,
    /// Retired / unused (X-07 / D-018). Kept for discriminant stability; never written.
    Settling = 1,
    SettledYes = 2,
    SettledNo = 3,
    Void = 4,
}

impl From<MarketStatus> for u8 {
    fn from(s: MarketStatus) -> Self {
        s as u8
    }
}

#[account]
#[derive(InitSpace)]
pub struct StrikeMarket {
    pub config: Pubkey,
    pub market_id: u64,
    pub equity_symbol: [u8; 8],
    pub pyth_price_feed: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub strike_price_e6: u64,
    pub expiry_ts: i64,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub collateral_vault: Pubkey,
    pub phoenix_market: Pubkey,
    pub phoenix_base_mint: Pubkey,
    pub phoenix_quote_mint: Pubkey,
    pub status: u8,
    pub pairs_minted: u64,
    pub pairs_redeemed: u64,
    pub settlement_price_e6: u64,
    pub settled_at_ts: i64,
    pub settled_slot: u64,
    pub bump: u8,
    pub vault_bump: u8,
    /// Localnet simulated trading window (D-017). Default true on create so P0/P1 mint stays green.
    /// Cleared by `sim_close_session`; set by `sim_open_session`.
    pub trading_open: bool,
    /// Set true by `sim_open_session`. When armed, settle/admin_settle require `!trading_open`
    /// (SessionNotClosed). Unarmed markets (never sim-opened) keep legacy P0 settle-without-close.
    pub sim_armed: bool,
    pub reserved: [u8; 62],
}

impl StrikeMarket {
    pub fn is_open(&self) -> bool {
        self.status == MarketStatus::Open as u8
    }

    pub fn is_settled(&self) -> bool {
        self.status == MarketStatus::SettledYes as u8
            || self.status == MarketStatus::SettledNo as u8
    }

    pub fn winning_is_yes(&self) -> bool {
        self.status == MarketStatus::SettledYes as u8
    }

    /// When a sim session was armed, settle/admin require trading window closed first.
    pub fn require_session_closed_for_settle(&self) -> bool {
        self.sim_armed && self.trading_open
    }
}
