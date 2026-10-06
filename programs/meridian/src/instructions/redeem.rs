use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::MeridianError;
use crate::events::Redeemed;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        has_one = config,
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
    #[account(mut, token::authority = user)]
    pub user_collateral_ata: Account<'info, TokenAccount>,
    #[account(mut, token::authority = user)]
    pub user_winning_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winning_mint: Account<'info, Mint>,
    /// CHECK: treasury for redeem fee
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Redeem>, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::ZeroAmount);
    let market = &ctx.accounts.strike_market;
    require!(market.is_settled(), MeridianError::MarketNotSettled);

    let expected_mint = if market.winning_is_yes() {
        market.yes_mint
    } else {
        market.no_mint
    };
    require!(
        ctx.accounts.winning_mint.key() == expected_mint,
        MeridianError::InvalidWinningMint
    );
    require!(
        ctx.accounts.user_winning_ata.mint == expected_mint,
        MeridianError::InvalidWinningMint
    );

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

    // Burn winning tokens
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.winning_mint.to_account_info(),
                from: ctx.accounts.user_winning_ata.to_account_info(),
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
    market.pairs_redeemed = market
        .pairs_redeemed
        .checked_add(amount)
        .ok_or(MeridianError::MathOverflow)?;

    emit!(Redeemed {
        market: market.key(),
        user: ctx.accounts.user.key(),
        amount,
        collateral_paid: collateral_out,
        fee,
        pairs_redeemed_after: market.pairs_redeemed,
    });
    Ok(())
}
