//! Localnet-only SimClock init (D-017 / DLV-065). Deploy blocker — `localnet-test` only.
use anchor_lang::prelude::*;
use crate::constants::{CONFIG_SEED, SIM_CLOCK_SEED};
use crate::errors::MeridianError;
use crate::events::SimClockSet;
use crate::state::{Config, SimClock};

#[derive(Accounts)]
pub struct InitSimClock<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + SimClock::INIT_SPACE,
        seeds = [SIM_CLOCK_SEED],
        bump
    )]
    pub sim_clock: Account<'info, SimClock>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitSimClock>) -> Result<()> {
    let clock = Clock::get()?;
    let sim = &mut ctx.accounts.sim_clock;
    sim.authority = ctx.accounts.config.authority;
    sim.unix_timestamp = clock.unix_timestamp;
    sim.slot = clock.slot;
    sim.enabled = true;
    sim.bump = ctx.bumps.sim_clock;

    emit!(SimClockSet {
        unix_timestamp: sim.unix_timestamp,
        slot: sim.slot,
        authority: sim.authority,
    });
    Ok(())
}
