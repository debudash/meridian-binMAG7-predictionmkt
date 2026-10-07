use anchor_lang::prelude::*;
use crate::constants::{
    CONFIG_SEED, CONFIG_TIMELOCK_SECS, MAX_FEE_BPS, MIN_ADMIN_SETTLE_DELAY_SECS_PROD,
};
use crate::errors::MeridianError;
use crate::events::ConfigUpdated;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigParams {
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub settle_max_staleness_slots: u64,
    pub settle_max_conf_ratio_bps: u16,
    pub admin_settle_delay_secs: u64,
    pub treasury: Pubkey,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    require!(params.mint_fee_bps <= MAX_FEE_BPS, MeridianError::FeeTooHigh);
    require!(params.redeem_fee_bps <= MAX_FEE_BPS, MeridianError::FeeTooHigh);

    // Production hardening (Reviewer S2): fee caps always; timelock + min delay outside localnet-test.
    #[cfg(not(feature = "localnet-test"))]
    {
        require!(
            params.admin_settle_delay_secs >= MIN_ADMIN_SETTLE_DELAY_SECS_PROD,
            MeridianError::AdminSettleDelayTooLow
        );
        let clock = Clock::get()?;
        let earliest = ctx
            .accounts
            .config
            .last_config_update_ts
            .saturating_add(CONFIG_TIMELOCK_SECS);
        // First update (ts==0) allowed immediately after initialize.
        if ctx.accounts.config.last_config_update_ts != 0 {
            require!(
                clock.unix_timestamp >= earliest,
                MeridianError::ConfigTimelock
            );
        }
        ctx.accounts.config.last_config_update_ts = clock.unix_timestamp;
    }

    let config = &mut ctx.accounts.config;
    config.mint_fee_bps = params.mint_fee_bps;
    config.redeem_fee_bps = params.redeem_fee_bps;
    config.settle_max_staleness_slots = params.settle_max_staleness_slots;
    config.settle_max_conf_ratio_bps = params.settle_max_conf_ratio_bps;
    config.admin_settle_delay_secs = params.admin_settle_delay_secs;
    config.treasury = params.treasury;
    emit!(ConfigUpdated {
        authority: config.authority,
        paused: config.paused,
        mint_fee_bps: config.mint_fee_bps,
        redeem_fee_bps: config.redeem_fee_bps,
        settle_max_staleness_slots: config.settle_max_staleness_slots,
        settle_max_conf_ratio_bps: config.settle_max_conf_ratio_bps,
        admin_settle_delay_secs: config.admin_settle_delay_secs,
    });
    Ok(())
}
