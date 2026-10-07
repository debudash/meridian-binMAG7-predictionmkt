use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::constants::*;
use crate::errors::MeridianError;
use crate::events::ConfigInitialized;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitConfigParams {
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub settle_max_staleness_slots: u64,
    pub settle_max_conf_ratio_bps: u16,
    pub admin_settle_delay_secs: u64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub collateral_mint: Account<'info, Mint>,
    /// CHECK: fee destination; validated as writable token account by clients
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, params: InitConfigParams) -> Result<()> {
    require!(params.mint_fee_bps <= MAX_FEE_BPS, MeridianError::FeeTooHigh);
    require!(params.redeem_fee_bps <= MAX_FEE_BPS, MeridianError::FeeTooHigh);
    require!(
        ctx.accounts.collateral_mint.decimals == 6,
        MeridianError::InvalidCollateralDecimals
    );
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.collateral_mint = ctx.accounts.collateral_mint.key();
    config.collateral_decimals = ctx.accounts.collateral_mint.decimals;
    config.treasury = ctx.accounts.treasury.key();
    config.mint_fee_bps = params.mint_fee_bps;
    config.redeem_fee_bps = params.redeem_fee_bps;
    config.paused = false;
    config.settle_max_staleness_slots = params.settle_max_staleness_slots;
    config.settle_max_conf_ratio_bps = params.settle_max_conf_ratio_bps;
    config.admin_settle_delay_secs = params.admin_settle_delay_secs;
    config.next_market_id = 1;
    config.bump = ctx.bumps.config;
    config.last_config_update_ts = 0;
    config.reserved = [0u8; 40];
    emit!(ConfigInitialized {
        authority: config.authority,
        collateral_mint: config.collateral_mint,
    });
    Ok(())
}
