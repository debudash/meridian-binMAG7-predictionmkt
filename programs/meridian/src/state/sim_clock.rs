//! Localnet-only simulated clock (D-017 / DLV-065). Deploy blocker — `localnet-test` only.
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct SimClock {
    /// Must == Config.authority
    pub authority: Pubkey,
    /// Simulated Clock.unix_timestamp
    pub unix_timestamp: i64,
    /// Simulated Clock.slot (Pyth staleness under sim)
    pub slot: u64,
    /// If false, effective_clock falls back to Clock::get()
    pub enabled: bool,
    pub bump: u8,
}
