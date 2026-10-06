use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2");

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
}
