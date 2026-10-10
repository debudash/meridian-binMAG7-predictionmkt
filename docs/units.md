# Meridian Fixed-Point Units & Pyth Conversion

Canonical numeric scales for Meridian v1. Instruction and account fields that carry prices **must** use these rules.

---

## 1. Locked scales

| Name | Value | Used for |
| --- | --- | --- |
| `PRICE_SCALE` | `1_000_000` (1e6) | `strike_price_e6`, `settlement_price_e6`, UI Yes mid when quoted in dollars |
| Collateral / USDC | native mint decimals **6** | vault balances, mint/redeem amounts |
| Outcome tokens | decimals **6** (match collateral) | Yes / No SPL amounts |
| Fee bps | `10_000` = 100% | `mint_fee_bps`, `redeem_fee_bps`, `settle_max_conf_ratio_bps` |

**Rationale:** Align price fixed-point with USDC micro-units so `$1.00` collateral ↔ `1_000_000` raw ↔ one full outcome token claim when winning. Avoids a second scale (e.g. 1e9) in vault math.

---

## 2. Human ↔ on-chain

| Human | On-chain `u64` |
| --- | --- |
| Strike $180.00 | `180_000_000` |
| Strike $180.50 | `180_500_000` |
| Settlement $179.12 | `179_120_000` |
| $1.00 USDC | `1_000_000` |
| 2.5 Yes tokens | `2_500_000` |

Automation (D-026): reference = the previous trading day's close, rounded to `STRIKE_STEP_E6` (default **$5** at ≥ $100, else **$1**) for the ATM strike, plus each `STRIKE_OFFSETS_E6` offset (default −$5, 0, +$5; staging sets `0`, one ATM strike), dedupe → `strike_price_e6 = dollars * 1_000_000`.

---

## 3. Binary payout identity

For `amount` raw winning tokens redeemed (fee = 0):

```text
collateral_out = amount
```

Because decimals(Yes) == decimals(USDC) == 6 and `$1` payout per full token.

With redeem fee:

```text
fee = amount * redeem_fee_bps / 10_000
collateral_out = amount - fee
```

Mint collateral lock (fee on notional):

```text
fee = amount * mint_fee_bps / 10_000
collateral_in = amount + fee   // user pays; vault keeps `amount`, treasury gets `fee`
```

---

## 4. Pyth → `settlement_price_e6`

Pyth aggregate (Solana price account / price update):

| Pyth field | Type | Meaning |
| --- | --- | --- |
| `price` | `i64` | Price mantissa |
| `conf` | `u64` | Confidence interval mantissa (same expo) |
| `expo` | `i32` | Usually `-8` for equities |
| `publish_time` | `i64` | Unix seconds |
| publish slot | via account | For staleness in slots |

### 4.1 Reject gates (before convert)

```text
require(price > 0)                           // equities; no negative close for v1
require(slot_now - publish_slot <= Config.settle_max_staleness_slots)
conf_ratio_bps = conf * 10_000 / (price as u64)   // price > 0
require(conf_ratio_bps <= Config.settle_max_conf_ratio_bps)
```

Use `u128` intermediates for the ratio multiply.

### 4.2 Convert mantissa to 1e6

Human price and Meridian fixed-point:

```text
human_price         = price * 10^expo
settlement_price_e6 = human_price * 10^6
                    = price * 10^(expo + 6)
```

| `expo` | `expo + 6` | Operation on `price` |
| ---: | ---: | --- |
| -8 | -2 | `price / 100` |
| -6 | 0 | `price` as-is |
| -5 | +1 | `price * 10` |
| -4 | +2 | `price * 100` |

**Reference implementation:**

```rust
pub fn pyth_price_to_e6(price: i64, expo: i32) -> Result<u64, MeridianError> {
    if price <= 0 {
        return Err(MeridianError::InvalidPythPrice);
    }
    let p = price as u128;
    let shift = expo + 6; // scale into 1e6 fixed point

    let e6 = if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32))
            .ok_or(MeridianError::MathOverflow)?
    } else {
        let div = 10u128.pow((-shift) as u32);
        // towards zero (integer division) — document as such for settle fairness
        p / div
    };

    u64::try_from(e6).map_err(|_| MeridianError::MathOverflow)
}
```

**Example:** Pyth `price = 18_012_345_678`, `expo = -8` → human ≈ `180.12345678` → `e6 = 180_123_456` after `/ 100` (trunc toward zero).

### 4.3 Confidence in human terms (optional logging)

```text
conf_e6 = pyth_price_to_e6(conf as i64, expo)  // same convert; conf is u64 mantissa
```

Emit `pyth_conf` in `Settled` as raw Pyth `conf` mantissa **or** `conf_e6`; pick one and keep IDL stable. **Default for events:** raw Pyth `conf` (`u64`) plus `settlement_price_e6` already converted.

---

## 5. Outcome comparison

```text
outcome_yes = settlement_price_e6 >= strike_price_e6
```

Exact equality → **Yes wins** (default). Documented open question in SCHEMA.md if product prefers strict `>`.

---

## 6. Yes trading price vs settlement price

- **Settlement / strike:** equity USD in `PRICE_SCALE` (1e6).
- **Phoenix Yes price:** quote per base in Phoenix’s tick scheme (USDC per Yes token). Fully collateralized fair value of Yes is roughly in `[0, 1]` USDC before expiry (probability-ish), **not** the equity price.

Do not confuse `strike_price_e6` (~hundreds of dollars) with Phoenix mid (~0–1 USDC). Indexers should label them separately.

---

## 7. Clock units

| Field | Unit |
| --- | --- |
| `expiry_ts`, `settled_at_ts` | Unix **seconds** (`i64`, Solana `Clock`) |
| `settle_max_staleness_slots` | **Slots** (`u64`) |
| `admin_settle_delay_secs` | Unix second delta |

---

## 8. Test vectors (for unit tests)

| price | expo | expected `settlement_price_e6` |
| ---: | ---: | ---: |
| `18_000_000_000` | -8 | `180_000_000` ($180.00) |
| `18_050_000_000` | -8 | `180_500_000` ($180.50) |
| `180_000_000` | -6 | `180_000_000` |
| `1` | -8 | `0` (truncates; reject if `e6 == 0` after convert) |

Reject `e6 == 0` after conversion as `InvalidPythPrice` for equities.
