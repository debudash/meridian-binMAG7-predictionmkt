use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};
use crate::constants::*;
use crate::errors::MeridianError;
use crate::events::Minted;
use crate::state::{Config, StrikeMarket};

#[derive(Accounts)]
pub struct MintPair<'info> {
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

pub fn handler(ctx: Context<MintPair>, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::ZeroAmount);
    require!(!ctx.accounts.config.paused, MeridianError::Paused);
    require!(ctx.accounts.strike_market.is_open(), MeridianError::MarketNotOpen);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < ctx.accounts.strike_market.expiry_ts,
        MeridianError::MintAfterExpiry
    );

    let fee = (amount as u128)
        .checked_mul(ctx.accounts.config.mint_fee_bps as u128)
        .ok_or(MeridianError::MathOverflow)?
        / 10_000u128;
    let fee = u64::try_from(fee).map_err(|_| MeridianError::MathOverflow)?;
    let collateral_in = amount
        .checked_add(fee)
        .ok_or(MeridianError::MathOverflow)?;

    // Transfer collateral → vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_collateral_ata.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        collateral_in,
    )?;

    // Fee → treasury (if any) from vault immediately (fee-on-transfer-in preference)
    if fee > 0 {
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
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            fee,
        )?;
    }

    let market_key = ctx.accounts.strike_market.key();
    let seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        market_key.as_ref(),
        &[ctx.accounts.strike_market.vault_bump],
    ];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.user_no_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let market = &mut ctx.accounts.strike_market;
    market.pairs_minted = market
        .pairs_minted
        .checked_add(amount)
        .ok_or(MeridianError::MathOverflow)?;

    emit!(Minted {
        market: market.key(),
        user: ctx.accounts.user.key(),
        amount,
        collateral_locked: amount,
        fee,
        pairs_minted_after: market.pairs_minted,
    });
    Ok(())
}
