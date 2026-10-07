//! Localnet-only SimClock warp (D-017 / DLV-065). Deploy blocker — `localnet-test` only.
use anchor_lang::prelude::*;
use crate::constants::{CONFIG_SEED, SIM_CLOCK_SEED};
use crate::errors::MeridianError;
use crate::events::SimClockSet;
use crate::state::{Config, SimClock};

#[derive(Accounts)]
pub struct WarpSimClock<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [SIM_CLOCK_SEED],
        bump = sim_clock.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub sim_clock: Account<'info, SimClock>,
}

pub fn handler(ctx: Context<WarpSimClock>, add_secs: i64, add_slots: u64) -> Result<()> {
    let sim = &mut ctx.accounts.sim_clock;
    require!(sim.enabled, MeridianError::SimClockNotEnabled);
    require_keys_eq!(
        sim.authority,
        ctx.accounts.config.authority,
        MeridianError::Unauthorized
    );
    // Saturating add — warp must not panic on overflow in tests.
    sim.unix_timestamp = sim.unix_timestamp.saturating_add(add_secs);
    sim.slot = sim.slot.saturating_add(add_slots);

    emit!(SimClockSet {
        unix_timestamp: sim.unix_timestamp,
        slot: sim.slot,
        authority: sim.authority,
    });
    Ok(())
}
