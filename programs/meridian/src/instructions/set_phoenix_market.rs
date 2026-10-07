use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::events::PhoenixMarketSet;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct SetPhoenixMarket<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        has_one = config @ MeridianError::Unauthorized
    )]
    pub strike_market: Account<'info, StrikeMarket>,
}

pub fn handler(ctx: Context<SetPhoenixMarket>, phoenix_market: Pubkey) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    // Phoenix wiring placeholder: base=Yes, quote=collateral (D-004 / D-015)
    require!(
        market.phoenix_base_mint == market.yes_mint
            && market.phoenix_quote_mint == ctx.accounts.config.collateral_mint,
        MeridianError::InvalidPhoenixMints
    );
    market.phoenix_market = phoenix_market;
    emit!(PhoenixMarketSet {
        market: market.key(),
        phoenix_market,
        phoenix_base_mint: market.phoenix_base_mint,
        phoenix_quote_mint: market.phoenix_quote_mint,
    });
    Ok(())
}
