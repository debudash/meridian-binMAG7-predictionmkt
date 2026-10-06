use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::events::ConfigUpdated;
use crate::state::Config;

#[derive(Accounts)]
pub struct Pause<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = true;
    emit_updated(config);
    Ok(())
}

pub fn unpause_handler(ctx: Context<Pause>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = false;
    emit_updated(config);
    Ok(())
}

fn emit_updated(config: &Config) {
    emit!(ConfigUpdated {
        authority: config.authority,
        paused: config.paused,
        mint_fee_bps: config.mint_fee_bps,
        redeem_fee_bps: config.redeem_fee_bps,
        settle_max_staleness_slots: config.settle_max_staleness_slots,
        settle_max_conf_ratio_bps: config.settle_max_conf_ratio_bps,
        admin_settle_delay_secs: config.admin_settle_delay_secs,
    });
}
