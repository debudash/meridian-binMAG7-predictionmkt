use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::MeridianError;
use crate::events::Merged;
use crate::state::{Config, StrikeMarket};

/// Open-state inverse of `mint` (D-018). Burn equal Yes+No; vault pays
/// `amount − redeem_fee_bps`; decrement `pairs_minted`. Pause blocks; no expiry gate.
#[derive(Accounts)]
pub struct MergePair<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = collateral_mint
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        has_one = config,
        has_one = yes_mint,
        has_one = no_mint,
        has_one = collateral_vault,
    )]
    pub strike_market: Account<'info, StrikeMarket>,
    #[account(mut)]
    pub collateral_vault: Account<'info, TokenAccount>,
    /// CHECK: vault authority PDA
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, strike_market.key().as_ref()],
        bump = strike_market.vault_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, token::mint = collateral_mint, token::authority = user)]
    pub user_collateral_ata: Account<'info, TokenAccount>,
    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes_ata: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,
    /// CHECK: must equal config.treasury (fee destination)
    #[account(mut, address = config.treasury)]
    pub treasury: UncheckedAccount<'info>,
    pub collateral_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<MergePair>, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::ZeroAmount);
    require!(!ctx.accounts.config.paused, MeridianError::Paused);
    require!(
        ctx.accounts.strike_market.is_open(),
        MeridianError::MarketNotOpen
    );
    // No expiry gate (unlike mint) — merge allowed after expiry_ts while Open.
    // No trading_open gate — unwind is independent of sim session window.

    let fee = (amount as u128)
        .checked_mul(ctx.accounts.config.redeem_fee_bps as u128)
        .ok_or(MeridianError::MathOverflow)?
        / 10_000u128;
    let fee = u64::try_from(fee).map_err(|_| MeridianError::MathOverflow)?;
    let collateral_out = amount
        .checked_sub(fee)
        .ok_or(MeridianError::MathOverflow)?;

    require!(
        ctx.accounts.collateral_vault.amount >= amount,
        MeridianError::InsufficientVault
    );

    // Burn Yes then No from user (equal amounts).
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.yes_mint.to_account_info(),
                from: ctx.accounts.user_yes_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.no_mint.to_account_info(),
                from: ctx.accounts.user_no_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

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
                to: ctx.accounts.user_collateral_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[seeds],
        ),
        collateral_out,
    )?;

    if fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            fee,
        )?;
    }

    let market = &mut ctx.accounts.strike_market;
    market.pairs_minted = market
        .pairs_minted
        .checked_sub(amount)
        .ok_or(MeridianError::MathOverflow)?;

    emit!(Merged {
        market: market.key(),
        user: ctx.accounts.user.key(),
        amount,
        fee,
        pairs_minted_after: market.pairs_minted,
    });
    Ok(())
}
