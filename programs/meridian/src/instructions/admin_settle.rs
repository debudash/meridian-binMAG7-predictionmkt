use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::events::AdminSettled;
use crate::state::{Config, MarketStatus, StrikeMarket};

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
}

pub fn handler(
    ctx: Context<AdminSettle>,
    settlement_price_e6: u64,
    outcome_yes: bool,
) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);

    let clock = Clock::get()?;
    let earliest = market
        .expiry_ts
        .checked_add(ctx.accounts.config.admin_settle_delay_secs as i64)
        .ok_or(MeridianError::MathOverflow)?;
    require!(
        clock.unix_timestamp >= earliest,
        MeridianError::AdminSettleTooEarly
    );
    require!(settlement_price_e6 > 0, MeridianError::InvalidPythPrice);

    market.settlement_price_e6 = settlement_price_e6;
    market.settled_at_ts = clock.unix_timestamp;
    market.settled_slot = clock.slot;
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
        slot: clock.slot,
        ts: clock.unix_timestamp,
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}
