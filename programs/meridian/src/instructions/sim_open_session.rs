//! Localnet-only simulated session open (D-017). Deploy blocker — `localnet-test` only.
use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct SimOpenSession<'info> {
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

pub fn handler(ctx: Context<SimOpenSession>) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);
    market.trading_open = true;
    market.sim_armed = true;
    Ok(())
}
