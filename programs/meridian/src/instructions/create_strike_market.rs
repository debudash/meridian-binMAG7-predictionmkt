use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::constants::*;
use crate::errors::MeridianError;
use crate::events::MarketCreated;
use crate::state::{Config, MarketStatus, StrikeMarket};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateStrikeParams {
    pub equity_symbol: [u8; 8],
    pub strike_price_e6: u64,
    pub expiry_ts: i64,
    pub pyth_feed_id: [u8; 32],
    pub phoenix_market: Pubkey,
}

#[derive(Accounts)]
#[instruction(params: CreateStrikeParams)]
pub struct CreateStrikeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized,
        has_one = collateral_mint
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + StrikeMarket::INIT_SPACE,
        seeds = [
            STRIKE_MARKET_SEED,
            params.equity_symbol.as_ref(),
            &params.expiry_ts.to_le_bytes(),
            &params.strike_price_e6.to_le_bytes()
        ],
        bump
    )]
    pub strike_market: Account<'info, StrikeMarket>,
    #[account(
        init,
        payer = authority,
        seeds = [YES_MINT_SEED, strike_market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_authority,
    )]
    pub yes_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [NO_MINT_SEED, strike_market.key().as_ref()],
        bump,
        mint::decimals = 6,
        mint::authority = vault_authority,
    )]
    pub no_mint: Account<'info, Mint>,
    /// CHECK: PDA vault authority
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, strike_market.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, strike_market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = vault_authority,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,
    pub collateral_mint: Account<'info, Mint>,
    /// CHECK: Pyth price account pubkey stored; validated at settle
    pub pyth_price_feed: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateStrikeMarket>, params: CreateStrikeParams) -> Result<()> {
    require!(!ctx.accounts.config.paused, MeridianError::Paused);
    require!(params.strike_price_e6 > 0, MeridianError::InvalidPythPrice);

    let market_id = ctx.accounts.config.next_market_id;
    ctx.accounts.config.next_market_id = market_id
        .checked_add(1)
        .ok_or(MeridianError::MathOverflow)?;

    let market = &mut ctx.accounts.strike_market;
    market.config = ctx.accounts.config.key();
    market.market_id = market_id;
    market.equity_symbol = params.equity_symbol;
    market.pyth_price_feed = ctx.accounts.pyth_price_feed.key();
    market.pyth_feed_id = params.pyth_feed_id;
    market.strike_price_e6 = params.strike_price_e6;
    market.expiry_ts = params.expiry_ts;
    market.yes_mint = ctx.accounts.yes_mint.key();
    market.no_mint = ctx.accounts.no_mint.key();
    market.collateral_vault = ctx.accounts.collateral_vault.key();
    market.phoenix_market = params.phoenix_market;
    market.phoenix_base_mint = ctx.accounts.yes_mint.key();
    market.phoenix_quote_mint = ctx.accounts.collateral_mint.key();
    market.status = MarketStatus::Open as u8;
    market.pairs_minted = 0;
    market.pairs_redeemed = 0;
    market.settlement_price_e6 = 0;
    market.settled_at_ts = 0;
    market.settled_slot = 0;
    market.bump = ctx.bumps.strike_market;
    market.vault_bump = ctx.bumps.vault_authority;
    // D-017: default open for trading so P0/P1 mint-after-create stays green.
    // sim_armed stays false until sim_open_session — settle-without-close remains OK for legacy suite.
    market.trading_open = true;
    market.sim_armed = false;
    market.reserved = [0u8; 62];

    emit!(MarketCreated {
        market: market.key(),
        market_id,
        equity_symbol: params.equity_symbol,
        strike_price_e6: params.strike_price_e6,
        expiry_ts: params.expiry_ts,
        yes_mint: market.yes_mint,
        no_mint: market.no_mint,
        collateral_vault: market.collateral_vault,
        phoenix_market: market.phoenix_market,
        pyth_price_feed: market.pyth_price_feed,
    });
    Ok(())
}
