use anchor_lang::prelude::*;
use crate::constants::{MOCK_PYTH_MAGIC, PRICE_UPDATE_V2_DISCRIMINATOR, SLOT_MS};
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

/// Pyth pull-oracle `PriceUpdateV2` (pyth-solana-receiver-sdk), decoded with a minimal borsh
/// reader instead of the SDK crate (its dependency tree needs rustc >= 1.87; host IDL build is 1.85).
///
/// Layout: discriminator[8] | write_authority[32] | verification_level (borsh enum:
/// `0 = Partial { num_signatures: u8 }`, `1 = Full`) | PriceFeedMessage {
/// feed_id[32], price i64, conf u64, exponent i32, publish_time i64, prev_publish_time i64,
/// ema_price i64, ema_conf u64 } | posted_slot u64. Accounts are allocated 134 bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PriceUpdateV2View {
    pub write_authority: Pubkey,
    pub fully_verified: bool,
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub posted_slot: u64,
}

/// Bytes after the verification-level enum: PriceFeedMessage (84) + posted_slot (8).
const PRICE_UPDATE_V2_TAIL: usize = 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;

pub fn parse_price_update_v2(data: &[u8]) -> Result<PriceUpdateV2View> {
    require!(data.len() >= 8 + 32 + 1, MeridianError::InvalidPythAccount);
    require!(
        data[0..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        MeridianError::InvalidPythAccount
    );
    let write_authority = Pubkey::new_from_array(data[8..40].try_into().unwrap());
    let (fully_verified, mut o) = match data[40] {
        0 => (false, 42usize), // Partial { num_signatures }
        1 => (true, 41usize),  // Full
        _ => return err!(MeridianError::InvalidPythAccount),
    };
    require!(
        data.len() >= o + PRICE_UPDATE_V2_TAIL,
        MeridianError::InvalidPythAccount
    );
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[o..o + 32]);
    o += 32;
    let rd8 = |o: usize| -> [u8; 8] { data[o..o + 8].try_into().unwrap() };
    let price = i64::from_le_bytes(rd8(o));
    let conf = u64::from_le_bytes(rd8(o + 8));
    let expo = i32::from_le_bytes(data[o + 16..o + 20].try_into().unwrap());
    let publish_time = i64::from_le_bytes(rd8(o + 20));
    let prev_publish_time = i64::from_le_bytes(rd8(o + 28));
    // ema_price @ o+36, ema_conf @ o+44 — unused.
    let posted_slot = u64::from_le_bytes(rd8(o + 52));
    Ok(PriceUpdateV2View {
        write_authority,
        fully_verified,
        feed_id,
        price,
        conf,
        expo,
        publish_time,
        prev_publish_time,
        posted_slot,
    })
}

/// D-005 staleness (slots) expressed as a publish-time window in seconds (150 slots → 60 s).
pub fn publish_window_secs(max_staleness_slots: u64) -> i64 {
    let secs = max_staleness_slots.saturating_mul(SLOT_MS) / 1_000;
    i64::try_from(secs).unwrap_or(i64::MAX)
}

/// D-025 settle-price rule: the update must be the **first** Pyth price at/after expiry
/// (`prev_publish_time < expiry_ts <= publish_time`, same rule as Pyth EVM
/// `parsePriceFeedUpdatesUnique`) and published no later than `expiry_ts + window_secs`.
pub fn check_publish_window(
    expiry_ts: i64,
    publish_time: i64,
    prev_publish_time: i64,
    window_secs: i64,
) -> Result<()> {
    require!(
        publish_time >= expiry_ts && prev_publish_time < expiry_ts,
        MeridianError::PythPriceNotAtExpiry
    );
    require!(
        publish_time <= expiry_ts.saturating_add(window_secs),
        MeridianError::StalePythPrice
    );
    Ok(())
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

    fn b64(s: &str) -> Vec<u8> {
        // tiny std-only base64 decoder for fixtures
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::new();
        let (mut buf, mut bits) = (0u32, 0u32);
        for c in s.bytes().filter(|c| *c != b'=') {
            let v = T.iter().position(|t| *t == c).unwrap() as u32;
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        out
    }

    /// devnet push feed shard-1 AAPL `D9uk39pq…` getAccountInfo 2026-10-08 (Full).
    const DEVNET_AAPL: &str = "IvEjY51+9M20lIZyMNU/Ew6sDypIEyPeOYmooRWTOJq2X67JeylJMQFJ9rZcsd5rEOr3XnwDygKcMG0DV+kbUxGxdQhKWtVWiOgyAQIAAAAAxAkAAAAAAAD7////TfrGagAAAABM+sZqAAAAAOQzAQIAAAAABAAAAAAAAAD9iFEeAAAAAAA=";
    const AAPL_FEED: &str = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

    fn hex32(h: &str) -> [u8; 32] {
        let mut o = [0u8; 32];
        for i in 0..32 {
            o[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
        }
        o
    }

    #[test]
    fn pull_parse_real_devnet_price_update_v2() {
        let d = b64(DEVNET_AAPL);
        assert_eq!(d.len(), 134);
        let v = parse_price_update_v2(&d).unwrap();
        assert!(v.fully_verified);
        assert_eq!(v.feed_id, hex32(AAPL_FEED));
        assert_eq!(v.price, 33_633_000);
        assert_eq!(v.expo, -5);
        assert_eq!(v.publish_time, 1_791_425_101);
        assert_eq!(v.prev_publish_time, 1_791_425_100);
        assert_eq!(pyth_price_to_e6(v.price, v.expo).unwrap(), 336_330_000);
        assert_eq!(v.write_authority.to_string(), "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW");
    }

    #[test]
    fn pull_parse_partial_shifts_offsets_and_flags() {
        let full = b64(DEVNET_AAPL);
        let mut partial = Vec::new();
        partial.extend_from_slice(&full[..40]);
        partial.push(0);
        partial.push(5);
        partial.extend_from_slice(&full[41..133]);
        let v = parse_price_update_v2(&partial).unwrap();
        assert!(!v.fully_verified);
        assert_eq!(v.price, 33_633_000);
        assert_eq!(v.publish_time, 1_791_425_101);
    }

    #[test]
    fn pull_parse_rejects_bad_discriminator_tag_and_short() {
        let d = b64(DEVNET_AAPL);
        let mut bad = d.clone();
        bad[0] ^= 1;
        assert!(parse_price_update_v2(&bad).is_err());
        let mut tag = d.clone();
        tag[40] = 2;
        assert!(parse_price_update_v2(&tag).is_err());
        assert!(parse_price_update_v2(&d[..100]).is_err());
        let mock = MockPythPrice { price: 1, conf: 0, expo: -8, publish_slot: 1, feed_id: [0; 32] }.pack();
        assert!(parse_price_update_v2(&mock).is_err());
    }

    #[test]
    fn pull_publish_window_rules() {
        let e = 1_000_000;
        assert_eq!(publish_window_secs(150), 60);
        assert!(check_publish_window(e, e, e - 1, 60).is_ok());
        assert!(check_publish_window(e, e + 60, e - 5, 60).is_ok());
        assert!(check_publish_window(e, e + 61, e - 5, 60).is_err()); // stale
        assert!(check_publish_window(e, e - 1, e - 2, 60).is_err()); // before expiry
        assert!(check_publish_window(e, e + 3, e + 2, 60).is_err()); // not first
        assert!(check_publish_window(e, e, e, 60).is_err()); // same-second later aggregate
    }
}
