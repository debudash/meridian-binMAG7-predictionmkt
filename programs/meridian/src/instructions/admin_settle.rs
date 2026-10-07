use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
#[cfg(feature = "localnet-test")]
use crate::constants::SIM_CLOCK_SEED;
use crate::errors::MeridianError;
use crate::events::AdminSettled;
use crate::state::{Config, MarketStatus, StrikeMarket};
#[cfg(feature = "localnet-test")]
use crate::state::SimClock;
use crate::utils::EffectiveClock;

#[derive(Accounts)]
pub struct AdminSettle<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ MeridianError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub strike_market: Account<'info, StrikeMarket>,
    /// Optional localnet SimClock PDA — omitted → wall Clock::get().
    #[cfg(feature = "localnet-test")]
    #[account(
        seeds = [SIM_CLOCK_SEED],
        bump,
    )]
    pub sim_clock: Option<Account<'info, SimClock>>,
}

pub fn handler(
    ctx: Context<AdminSettle>,
    settlement_price_e6: u64,
    outcome_yes: bool,
) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);
    require!(
        !market.require_session_closed_for_settle(),
        MeridianError::SessionNotClosed
    );

    #[cfg(feature = "localnet-test")]
    let eff: EffectiveClock = crate::utils::effective_clock(&ctx.accounts.sim_clock)?;
    #[cfg(not(feature = "localnet-test"))]
    let eff: EffectiveClock = crate::utils::effective_clock()?;
    let earliest = market
        .expiry_ts
        .checked_add(ctx.accounts.config.admin_settle_delay_secs as i64)
        .ok_or(MeridianError::MathOverflow)?;
    require!(
        eff.unix_timestamp >= earliest,
        MeridianError::AdminSettleTooEarly
    );
    require!(settlement_price_e6 > 0, MeridianError::InvalidPythPrice);

    // A-05 / D-018 Policy A: outcome_yes must match implied Yes (price_e6 >= strike).
    let implied_yes = settlement_price_e6 >= market.strike_price_e6;
    require!(
        outcome_yes == implied_yes,
        MeridianError::OutcomeInconsistent
    );

    market.settlement_price_e6 = settlement_price_e6;
    market.settled_at_ts = eff.unix_timestamp;
    market.settled_slot = eff.slot;
    market.status = if outcome_yes {
        MarketStatus::SettledYes as u8
    } else {
        MarketStatus::SettledNo as u8
    };

    emit!(AdminSettled {
        market: market.key(),
        settlement_price_e6,
        strike_price_e6: market.strike_price_e6,
        outcome_yes,
        pyth_conf: 0,
        slot: eff.slot,
        ts: eff.unix_timestamp,
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}
