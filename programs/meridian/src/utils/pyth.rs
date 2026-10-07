use anchor_lang::prelude::*;
use crate::constants::{MOCK_PYTH_MAGIC, PYTH_PRICE_MAGIC};
use crate::errors::MeridianError;

/// Convert Pyth mantissa+expo → PRICE_SCALE (1e6). Toward-zero for negative shift.
/// Rejects non-positive price and zero e6 after conversion (equities).
pub fn pyth_price_to_e6(price: i64, expo: i32) -> Result<u64> {
    if price <= 0 {
        return err!(MeridianError::InvalidPythPrice);
    }
    let p = price as u128;
    let shift = expo + 6;
    let e6 = if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32))
            .ok_or(MeridianError::MathOverflow)?
    } else {
        let div = 10u128.pow((-shift) as u32);
        p / div
    };
    let e6_u64 = u64::try_from(e6).map_err(|_| MeridianError::MathOverflow)?;
    if e6_u64 == 0 {
        return err!(MeridianError::InvalidPythPrice);
    }
    Ok(e6_u64)
}

/// Normalized view used by settle (mock or real).
#[derive(Clone, Copy, Debug)]
pub struct PythPriceView {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_slot: u64,
    pub feed_id: [u8; 32],
}

/// Compact mock Pyth price account for localnet-test only (D-005 gates).
/// Layout (little-endian):
/// magic:u32 | price:i64 | conf:u64 | expo:i32 | publish_slot:u64 | feed_id:[u8;32]
#[derive(Clone, Copy, Debug)]
pub struct MockPythPrice {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_slot: u64,
    pub feed_id: [u8; 32],
}

impl MockPythPrice {
    pub const LEN: usize = 4 + 8 + 8 + 4 + 8 + 32;

    pub fn pack(&self) -> [u8; Self::LEN] {
        let mut buf = [0u8; Self::LEN];
        buf[0..4].copy_from_slice(&MOCK_PYTH_MAGIC.to_le_bytes());
        buf[4..12].copy_from_slice(&self.price.to_le_bytes());
        buf[12..20].copy_from_slice(&self.conf.to_le_bytes());
        buf[20..24].copy_from_slice(&self.expo.to_le_bytes());
        buf[24..32].copy_from_slice(&self.publish_slot.to_le_bytes());
        buf[32..64].copy_from_slice(&self.feed_id);
        buf
    }

    pub fn unpack(data: &[u8]) -> Result<Self> {
        require!(data.len() >= Self::LEN, MeridianError::InvalidPythAccount);
        let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
        require!(magic == MOCK_PYTH_MAGIC, MeridianError::InvalidPythAccount);
        let mut feed_id = [0u8; 32];
        feed_id.copy_from_slice(&data[32..64]);
        Ok(Self {
            price: i64::from_le_bytes(data[4..12].try_into().unwrap()),
            conf: u64::from_le_bytes(data[12..20].try_into().unwrap()),
            expo: i32::from_le_bytes(data[20..24].try_into().unwrap()),
            publish_slot: u64::from_le_bytes(data[24..32].try_into().unwrap()),
            feed_id,
        })
    }

    pub fn view(&self) -> PythPriceView {
        PythPriceView {
            price: self.price,
            conf: self.conf,
            expo: self.expo,
            publish_slot: self.publish_slot,
            feed_id: self.feed_id,
        }
    }
}

/// Localnet-test: mock layout only.
#[cfg(feature = "localnet-test")]
pub fn load_pyth_price(data: &[u8]) -> Result<PythPriceView> {
    Ok(MockPythPrice::unpack(data)?.view())
}

/// Production / non-localnet: legacy Pyth Price account (magic 0xa1b2c3d4).
/// Rejects Meridian mock magic so a mis-deployed mock account cannot settle.
///
/// Layout offsets aligned with pyth-sdk-solana `Price` (legacy):
/// - magic @ 0 (u32)
/// - expo @ 20 (i32)
/// - agg.price @ 208 (i64), agg.conf @ 216 (u64), agg.pub_slot @ 232 (u64)
/// Feed id is not embedded in legacy Price; caller matches `pyth_price_feed` pubkey.
/// `feed_id` returned as zeros — settle compares only when market.pyth_feed_id != 0.
#[cfg(not(feature = "localnet-test"))]
pub fn load_pyth_price(data: &[u8]) -> Result<PythPriceView> {
    require!(data.len() >= 240, MeridianError::InvalidPythAccount);
    let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
    require!(magic != MOCK_PYTH_MAGIC, MeridianError::InvalidPythAccount);
    require!(magic == PYTH_PRICE_MAGIC, MeridianError::InvalidPythAccount);
    let expo = i32::from_le_bytes(data[20..24].try_into().unwrap());
    let price = i64::from_le_bytes(data[208..216].try_into().unwrap());
    let conf = u64::from_le_bytes(data[216..224].try_into().unwrap());
    let publish_slot = u64::from_le_bytes(data[232..240].try_into().unwrap());
    Ok(PythPriceView {
        price,
        conf,
        expo,
        publish_slot,
        feed_id: [0u8; 32],
    })
}

pub fn check_staleness(slot_now: u64, publish_slot: u64, max_staleness: u64) -> Result<()> {
    let age = slot_now.saturating_sub(publish_slot);
    require!(age <= max_staleness, MeridianError::StalePythPrice);
    Ok(())
}

pub fn check_confidence(price: i64, conf: u64, max_conf_bps: u16) -> Result<()> {
    require!(price > 0, MeridianError::InvalidPythPrice);
    let ratio = (conf as u128)
        .checked_mul(10_000)
        .ok_or(MeridianError::MathOverflow)?
        / (price as u128);
    require!(ratio <= max_conf_bps as u128, MeridianError::PythConfidenceTooWide);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vectors_units_md_s8() {
        assert_eq!(pyth_price_to_e6(18_000_000_000, -8).unwrap(), 180_000_000);
        assert_eq!(pyth_price_to_e6(18_050_000_000, -8).unwrap(), 180_500_000);
        assert_eq!(pyth_price_to_e6(180_000_000, -6).unwrap(), 180_000_000);
        assert!(pyth_price_to_e6(1, -8).is_err());
    }
}
