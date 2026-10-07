//! Effective clock for mint/settle time gates (D-017 / DLV-065).
use anchor_lang::prelude::*;

#[cfg(feature = "localnet-test")]
use crate::state::SimClock;

pub struct EffectiveClock {
    pub unix_timestamp: i64,
    pub slot: u64,
}

/// Production builds: body is only Clock::get() — no SimClock types compiled in.
#[cfg(feature = "localnet-test")]
pub fn effective_clock(sim: &Option<Account<SimClock>>) -> Result<EffectiveClock> {
    if let Some(sim) = sim {
        if sim.enabled {
            return Ok(EffectiveClock {
                unix_timestamp: sim.unix_timestamp,
                slot: sim.slot,
            });
        }
    }
    let c = Clock::get()?;
    Ok(EffectiveClock {
        unix_timestamp: c.unix_timestamp,
        slot: c.slot,
    })
}

#[cfg(not(feature = "localnet-test"))]
pub fn effective_clock() -> Result<EffectiveClock> {
    let c = Clock::get()?;
    Ok(EffectiveClock {
        unix_timestamp: c.unix_timestamp,
        slot: c.slot,
    })
}
