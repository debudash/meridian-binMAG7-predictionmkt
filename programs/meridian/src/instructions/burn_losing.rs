use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct BurnLosing<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(has_one = config)]
    pub strike_market: Account<'info, StrikeMarket>,
    #[account(mut, token::authority = user)]
    pub user_losing_ata: Account<'info, TokenAccount>,
    pub losing_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<BurnLosing>, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::ZeroAmount);
    let market = &ctx.accounts.strike_market;
    require!(market.is_settled(), MeridianError::MarketNotSettled);
    let losing = if market.winning_is_yes() {
        market.no_mint
    } else {
        market.yes_mint
    };
    require!(
        ctx.accounts.losing_mint.key() == losing,
        MeridianError::InvalidWinningMint
    );
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.losing_mint.to_account_info(),
                from: ctx.accounts.user_losing_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    Ok(())
}
