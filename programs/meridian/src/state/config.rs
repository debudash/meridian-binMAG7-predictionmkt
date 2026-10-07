use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_decimals: u8,
    pub treasury: Pubkey,
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub paused: bool,
    pub settle_max_staleness_slots: u64,
    pub settle_max_conf_ratio_bps: u16,
    pub admin_settle_delay_secs: u64,
    pub next_market_id: u64,
    pub bump: u8,
    pub reserved: [u8; 48],
}
