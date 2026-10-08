use anchor_lang::prelude::*;
use crate::constants::CONFIG_SEED;
#[cfg(feature = "localnet-test")]
use crate::constants::SIM_CLOCK_SEED;
use crate::errors::MeridianError;
use crate::events::Settled;
use crate::state::{Config, MarketStatus, StrikeMarket};
#[cfg(feature = "localnet-test")]
use crate::state::SimClock;
use crate::utils::EffectiveClock;
use crate::utils::pyth::{check_confidence, pyth_price_to_e6};
#[cfg(feature = "localnet-test")]
use crate::utils::pyth::{check_staleness, load_pyth_price};
#[cfg(not(feature = "localnet-test"))]
use crate::constants::PYTH_RECEIVER_PROGRAM_ID;
#[cfg(not(feature = "localnet-test"))]
use crate::utils::pyth::{check_publish_window, parse_price_update_v2, publish_window_secs};

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settler: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub strike_market: Account<'info, StrikeMarket>,
    /// Prod (D-025): any Pyth Solana Receiver-owned, fully verified `PriceUpdateV2` whose
    /// feed_id == strike_market.pyth_feed_id (a freshly posted update or the sponsored feed PDA).
    /// localnet-test: must equal strike_market.pyth_price_feed (Meridian mock layout).
    /// CHECK: owner, discriminator, verification level and feed id are validated in the handler.
    pub pyth_price_feed: UncheckedAccount<'info>,
    /// Optional localnet SimClock PDA — omitted → wall Clock::get().
    #[cfg(feature = "localnet-test")]
    #[account(
        seeds = [SIM_CLOCK_SEED],
        bump,
    )]
    pub sim_clock: Option<Account<'info, SimClock>>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let market = &mut ctx.accounts.strike_market;
    require!(market.is_open(), MeridianError::MarketNotOpen);
    require!(
        !market.require_session_closed_for_settle(),
        MeridianError::SessionNotClosed
    );
    #[cfg(feature = "localnet-test")]
    require!(
        ctx.accounts.pyth_price_feed.key() == market.pyth_price_feed,
        MeridianError::InvalidPythAccount
    );

    #[cfg(feature = "localnet-test")]
    let eff: EffectiveClock = crate::utils::effective_clock(&ctx.accounts.sim_clock)?;
    #[cfg(not(feature = "localnet-test"))]
    let eff: EffectiveClock = crate::utils::effective_clock()?;
    require!(
        eff.unix_timestamp >= market.expiry_ts,
        MeridianError::ExpiryNotReached
    );

    // localnet-test: Meridian mock layout + slot staleness (D-005 / D-017 harness).
    #[cfg(feature = "localnet-test")]
    let (price, conf, expo) = {
        let data = ctx.accounts.pyth_price_feed.try_borrow_data()?;
        let pyth = load_pyth_price(&data)?;
        if pyth.feed_id != [0u8; 32] {
            require!(
                pyth.feed_id == market.pyth_feed_id,
                MeridianError::InvalidPythAccount
            );
        }
        check_staleness(
            eff.slot,
            pyth.publish_slot,
            ctx.accounts.config.settle_max_staleness_slots,
        )?;
        (pyth.price, pyth.conf, pyth.expo)
    };

    // Production (D-025): Pyth pull oracle — receiver-owned, Full-verified PriceUpdateV2,
    // feed id pinned by the market, first price at/after expiry within the D-005 window.
    #[cfg(not(feature = "localnet-test"))]
    let (price, conf, expo) = {
        let acct = &ctx.accounts.pyth_price_feed;
        require_keys_eq!(
            *acct.owner,
            PYTH_RECEIVER_PROGRAM_ID,
            MeridianError::InvalidPythAccount
        );
        let data = acct.try_borrow_data()?;
        let upd = parse_price_update_v2(&data)?;
        require!(upd.fully_verified, MeridianError::InvalidPythAccount);
        require!(
            market.pyth_feed_id != [0u8; 32] && upd.feed_id == market.pyth_feed_id,
            MeridianError::InvalidPythAccount
        );
        check_publish_window(
            market.expiry_ts,
            upd.publish_time,
            upd.prev_publish_time,
            publish_window_secs(ctx.accounts.config.settle_max_staleness_slots),
        )?;
        (upd.price, upd.conf, upd.expo)
    };

    check_confidence(price, conf, ctx.accounts.config.settle_max_conf_ratio_bps)?;

    let settlement_price_e6 = pyth_price_to_e6(price, expo)?;
    let outcome_yes = settlement_price_e6 >= market.strike_price_e6;
    market.settlement_price_e6 = settlement_price_e6;
    market.settled_at_ts = eff.unix_timestamp;
    market.settled_slot = eff.slot;
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
        pyth_conf: conf,
        slot: eff.slot,
        ts: eff.unix_timestamp,
    });
    Ok(())
}
