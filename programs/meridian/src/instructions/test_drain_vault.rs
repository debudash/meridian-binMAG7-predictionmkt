//! Localnet/test fixture: authority drains USDC from a market vault (for V-07).
//! Not for mainnet — proves InsufficientVault on under-collateralized redeem.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::MeridianError;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct TestDrainVault<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config, has_one = collateral_vault)]
    pub strike_market: Account<'info, StrikeMarket>,
    #[account(mut)]
    pub collateral_vault: Account<'info, TokenAccount>,
    /// CHECK: vault authority PDA
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, strike_market.key().as_ref()],
        bump = strike_market.vault_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = collateral_vault.mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<TestDrainVault>, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::ZeroAmount);
    require!(
        ctx.accounts.collateral_vault.amount >= amount,
        MeridianError::InsufficientVault
    );
    let market_key = ctx.accounts.strike_market.key();
    let seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        market_key.as_ref(),
        &[ctx.accounts.strike_market.vault_bump],
    ];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    Ok(())
}
