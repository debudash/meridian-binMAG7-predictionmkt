use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");

#[program]
pub mod meridian {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: InitConfigParams,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, params)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }

    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::unpause_handler(ctx)
    }

    pub fn create_strike_market(
        ctx: Context<CreateStrikeMarket>,
        params: CreateStrikeParams,
    ) -> Result<()> {
        instructions::create_strike_market::handler(ctx, params)
    }

    pub fn set_phoenix_market(ctx: Context<SetPhoenixMarket>, phoenix_market: Pubkey) -> Result<()> {
        instructions::set_phoenix_market::handler(ctx, phoenix_market)
    }

    pub fn mint(ctx: Context<MintPair>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    pub fn merge_pair(ctx: Context<MergePair>, amount: u64) -> Result<()> {
        instructions::merge_pair::handler(ctx, amount)
    }


    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }

    pub fn admin_settle(
        ctx: Context<AdminSettle>,
        settlement_price_e6: u64,
        outcome_yes: bool,
    ) -> Result<()> {
        instructions::admin_settle::handler(ctx, settlement_price_e6, outcome_yes)
    }

    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
        instructions::redeem::handler(ctx, amount)
    }

    pub fn burn_losing(ctx: Context<BurnLosing>, amount: u64) -> Result<()> {
        instructions::burn_losing::handler(ctx, amount)
    }

    /// Localnet/test fixture — compiled only with `--features localnet-test` (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn upsert_mock_pyth(ctx: Context<UpsertMockPyth>, params: MockPythParams) -> Result<()> {
        instructions::upsert_mock_pyth::handler(ctx, params)
    }

    /// Localnet/test fixture — compiled only with `--features localnet-test` (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn test_drain_vault(ctx: Context<TestDrainVault>, amount: u64) -> Result<()> {
        instructions::test_drain_vault::handler(ctx, amount)
    }

    /// Localnet simulated session open (D-017) — `localnet-test` only (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn sim_open_session(ctx: Context<SimOpenSession>) -> Result<()> {
        instructions::sim_open_session::handler(ctx)
    }

    /// Localnet simulated session close (D-017) — `localnet-test` only (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn sim_close_session(ctx: Context<SimCloseSession>) -> Result<()> {
        instructions::sim_close_session::handler(ctx)
    }

    /// Localnet SimClock init (D-017 / DLV-065) — `localnet-test` only (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn init_sim_clock(ctx: Context<InitSimClock>) -> Result<()> {
        instructions::init_sim_clock::handler(ctx)
    }

    /// Localnet SimClock absolute set — `localnet-test` only (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn set_sim_clock(ctx: Context<SetSimClock>, unix_timestamp: i64, slot: u64) -> Result<()> {
        instructions::set_sim_clock::handler(ctx, unix_timestamp, slot)
    }

    /// Localnet SimClock relative warp — `localnet-test` only (deploy blocker).
    #[cfg(feature = "localnet-test")]
    pub fn warp_sim_clock(ctx: Context<WarpSimClock>, add_secs: i64, add_slots: u64) -> Result<()> {
        instructions::warp_sim_clock::handler(ctx, add_secs, add_slots)
    }

    /// Localnet SimClock disable (fall back to Clock::get) — `localnet-test` only.
    #[cfg(feature = "localnet-test")]
    pub fn disable_sim_clock(ctx: Context<DisableSimClock>) -> Result<()> {
        instructions::disable_sim_clock::handler(ctx)
    }
}
