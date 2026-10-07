//! Localnet-only simulated session close (D-017). Deploy blocker — `localnet-test` only.
use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct SimCloseSession<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub strike_market: Account<'info, StrikeMarket>,
}

pub fn handler(ctx: Context<SimCloseSession>) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);
    market.trading_open = false;
    // Keep sim_armed so settle still enforces close-first after an explicit sim_open.
    Ok(())
}
