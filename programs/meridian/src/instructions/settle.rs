use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
use crate::errors::MeridianError;
use crate::events::Settled;
use crate::state::{Config, MarketStatus, StrikeMarket};
use crate::utils::pyth::{
    check_confidence, check_staleness, pyth_price_to_e6, MockPythPrice,
};

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settler: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub strike_market: Account<'info, StrikeMarket>,
    /// CHECK: must match strike_market.pyth_price_feed; mock layout unpacked
    pub pyth_price_feed: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);
    require!(
        !market.require_session_closed_for_settle(),
        MeridianError::SessionNotClosed
    );
    require!(
        ctx.accounts.pyth_price_feed.key() == market.pyth_price_feed,
        MeridianError::InvalidPythAccount
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= market.expiry_ts,
        MeridianError::ExpiryNotReached
    );

    let data = ctx.accounts.pyth_price_feed.try_borrow_data()?;
    let pyth = MockPythPrice::unpack(&data)?;
    require!(
        pyth.feed_id == market.pyth_feed_id,
        MeridianError::InvalidPythAccount
    );

    check_staleness(
        clock.slot,
        pyth.publish_slot,
        ctx.accounts.config.settle_max_staleness_slots,
    )?;
    check_confidence(
        pyth.price,
        pyth.conf,
        ctx.accounts.config.settle_max_conf_ratio_bps,
    )?;

    let settlement_price_e6 = pyth_price_to_e6(pyth.price, pyth.expo)?;
    let outcome_yes = settlement_price_e6 >= market.strike_price_e6;
    market.settlement_price_e6 = settlement_price_e6;
    market.settled_at_ts = clock.unix_timestamp;
    market.settled_slot = clock.slot;
    market.status = if outcome_yes {
        MarketStatus::SettledYes as u8
    } else {
        MarketStatus::SettledNo as u8
    };

    emit!(Settled {
        market: market.key(),
        settlement_price_e6,
        strike_price_e6: market.strike_price_e6,
        outcome_yes,
        pyth_conf: pyth.conf,
        slot: clock.slot,
        ts: clock.unix_timestamp,
    });
    Ok(())
}
