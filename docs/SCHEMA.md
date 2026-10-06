# Meridian On-Chain Schema

Primary reference for Anchor account layouts, PDA seeds, Phoenix linkage, Pyth settlement refs, fixed-point units, instruction flows, events, and invariants.

Companion docs: [`accounts.md`](accounts.md) · [`flows.md`](flows.md) · [`units.md`](units.md) · [`../programs/meridian/README.md`](../programs/meridian/README.md)

**Program id (placeholder):** `Meridian11111111111111111111111111111111111` — replace at deploy.

**Collateral default:** USDC mainnet mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (devnet: use Circles USDC or fixture mint). Decimals = **6**.

**Price scale (LOCKED):** all Meridian strike / settlement / Yes prices use **`PRICE_SCALE = 1_000_000` (1e6)** — same as USDC micro-units. See [`units.md`](units.md) for Pyth `expo` conversion.

---

## 1. Account layouts

Sizes are Borsh / Anchor packed sizes excluding the 8-byte Anchor discriminator unless noted. Prefer `#[account]` + `InitSpace` in implementation; tables below are the canonical field list.

### 1.1 `Config` (global protocol config)

| Field | Type | Size | Notes |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 32 | Admin / multisig; can pause, update params, delayed admin settle |
| `collateral_mint` | `Pubkey` | 32 | USDC (or fixture) mint |
| `collateral_decimals` | `u8` | 1 | Expected `6` |
| `treasury` | `Pubkey` | 32 | Fee destination ATA or PDA (optional fees) |
| `mint_fee_bps` | `u16` | 2 | Fee on mint, basis points of collateral; `0` = off |
| `redeem_fee_bps` | `u16` | 2 | Fee on redeem; `0` = off |
| `paused` | `bool` | 1 | Global pause: blocks mint / create; settle+redeem may still run (policy: settle always allowed) |
| `settle_max_staleness_slots` | `u64` | 8 | Max Pyth price account age in slots at settle |
| `settle_max_conf_ratio_bps` | `u16` | 2 | Reject if `conf / |price|` > this (bps); e.g. `500` = 5% |
| `admin_settle_delay_secs` | `u64` | 8 | Min wall-clock seconds after `expiry_ts` before `admin_settle` |
| `bump` | `u8` | 1 | PDA bump |
| `_reserved` | `[u8; 64]` | 64 | Forward-compat |

**Approx space:** `8` (disc) + `32+32+1+32+2+2+1+8+2+8+1+64` ≈ `193` bytes → allocate `256` with padding.

**PDA seeds:**

```text
["config"]
```

**Authority:** program PDA; writable only by instructions that check `authority` signer (or timelock later).

---

### 1.2 `StrikeMarket` (one strike / outcome market)

One account per `(equity, expiry_day, strike)`. Holds Pyth + Phoenix wiring and settlement state.

| Field | Type | Size | Notes |
| --- | --- | --- | --- |
| `config` | `Pubkey` | 32 | Parent `Config` |
| `market_id` | `u64` | 8 | Monotonic id from config counter (optional convenience) |
| `equity_symbol` | `[u8; 8]` | 8 | ASCII, right-padded spaces; e.g. `AAPL\0\0\0\0` or space-pad — **default: space-pad** |
| `pyth_price_feed` | `Pubkey` | 32 | Pyth price account for this equity |
| `pyth_feed_id` | `[u8; 32]` | 32 | Pyth price feed id bytes (v2); redundant with account but useful for indexers |
| `strike_price_e6` | `u64` | 8 | Strike in `PRICE_SCALE` (1e6). Yes wins if settle ≥ strike (**default: ≥**) |
| `expiry_ts` | `i64` | 8 | Unix seconds; target ~16:00 ET close window |
| `yes_mint` | `Pubkey` | 32 | SPL mint for Yes tokens (decimals = collateral decimals) |
| `no_mint` | `Pubkey` | 32 | SPL mint for No tokens |
| `collateral_vault` | `Pubkey` | 32 | Token account PDA holding USDC |
| `phoenix_market` | `Pubkey` | 32 | Phoenix market account pubkey |
| `phoenix_base_mint` | `Pubkey` | 32 | **Default: `yes_mint`** |
| `phoenix_quote_mint` | `Pubkey` | 32 | **Default: `collateral_mint` (USDC)** |
| `status` | `u8` | 1 | `0=Open`, `1=Settling`, `2=SettledYes`, `3=SettledNo`, `4=Void` (admin) |
| `pairs_minted` | `u64` | 8 | Cumulative Yes(=No) tokens minted (raw token amount) |
| `pairs_redeemed` | `u64` | 8 | Cumulative winning tokens redeemed |
| `settlement_price_e6` | `u64` | 8 | Written at settle; `0` until settled |
| `settled_at_ts` | `i64` | 8 | Unix ts of settle ix; `0` until settled |
| `settled_slot` | `u64` | 8 | Slot of settle |
| `bump` | `u8` | 1 | Market PDA bump |
| `vault_bump` | `u8` | 1 | Collateral vault authority bump (if separate) |
| `_reserved` | `[u8; 64]` | 64 | Forward-compat |

**Approx space:** `8` + fields ≈ `320`+ → allocate `384` or use `InitSpace`.

**PDA seeds:**

```text
["strike_market", equity_symbol.as_ref(), expiry_ts.to_le_bytes(), strike_price_e6.to_le_bytes()]
```

**Alternative seed (if symbol padding is awkward):**

```text
["strike_market", market_id.to_le_bytes()]
```

Implementation may use `market_id` seeds if create ix allocates id from `Config.next_market_id` (add that counter to Config when scaffolding). **Default for this doc:** seed by `(equity_symbol, expiry_ts, strike_price_e6)`.

---

### 1.3 Vault PDAs

#### Collateral vault (token account)

- **Owner / authority:** PDA `["vault_authority", strike_market.key()]`
- **Token account:** ATA or raw token account with mint = `Config.collateral_mint`, authority = vault authority PDA
- **Holds:** USDC equal to outstanding unredeemed liability (`pairs_minted - pairs_redeemed` in $1 units, minus fees already skimmed)

| Concept | PDA seeds |
| --- | --- |
| Vault authority | `["vault_authority", strike_market.key().as_ref()]` |
| Settlement vault (optional alias) | Same PDA; Meridian uses one collateral vault per market. No separate settlement vault unless fees need isolation. |

**Default:** single `collateral_vault` per `StrikeMarket`. Fees (if `mint_fee_bps` / `redeem_fee_bps` > 0) transfer to `Config.treasury` at mint/redeem time — not held in market vault.

---

### 1.4 Yes mint + No mint

| Mint | Authority | Freeze authority | Decimals | PDA / creation |
| --- | --- | --- | --- | --- |
| Yes | Mint authority PDA `["yes_mint_authority", strike_market]` **or** vault authority | `None` (or program freeze on settle — **default: None**, rely on status checks) | `6` (match USDC) | Created in `create_strike_market`; address stored on `StrikeMarket.yes_mint` |
| No | Same pattern `["no_mint_authority", strike_market]` | `None` | `6` | Same |

**Token semantics:**

- Minting always creates **equal** Yes and No amounts to user ATAs (or a single recipient + optional split).
- 1 raw unit of Yes or No corresponds to `$1 / 10^decimals` of collateral claim **if that side wins** (i.e. 1 full token = $1 USDC payout when winning).

---

## 2. Phoenix market linkage

Meridian does **not** implement a CLOB. Each `StrikeMarket` references one Phoenix market.

| StrikeMarket field | Role |
| --- | --- |
| `phoenix_market` | Phoenix `MarketHeader` / market account pubkey |
| `phoenix_base_mint` | Must equal Yes mint (**default**) |
| `phoenix_quote_mint` | Must equal collateral mint (USDC) |

**Create flow (off-chain + on-chain):**

1. Create Meridian `StrikeMarket` + Yes/No mints + vault (Meridian ix).
2. Create / configure Phoenix market with `base_mint = yes_mint`, `quote_mint = usdc` (Phoenix ix / admin tooling).
3. Store `phoenix_market` on `StrikeMarket` via `set_phoenix_market` (authority) or pass at create if known.

**Trading:** users hold Yes (and optionally No) SPL tokens and trade Yes↔USDC on Phoenix. No outcome tokens are not the Phoenix base in the default wiring; UI maps “Buy No” to sell Yes (or mint+sell Yes), etc.

**Seats / trader accounts:** use standard Phoenix seat / trader state. Meridian accounts do **not** embed seat data; indexers join on `phoenix_market`.

**Open default labeled:** base = Yes. Alternative (base = No) is an open question — see §8.

---

## 3. Pyth feed refs

Stored on `StrikeMarket` and gated by `Config` global bounds:

| Parameter | Where | Default (sensible) |
| --- | --- | --- |
| Price account | `StrikeMarket.pyth_price_feed` | Per-equity Pyth Solana price account |
| Feed id | `StrikeMarket.pyth_feed_id` | 32-byte Pyth feed id |
| Max staleness | `Config.settle_max_staleness_slots` | **150 slots** (~60s on 400ms) — tune for close window |
| Max confidence ratio | `Config.settle_max_conf_ratio_bps` | **500 bps (5%)** — reject wider |

**Accept settle iff:**

1. `status == Open` (or `Settling`)
2. `clock.unix_timestamp >= expiry_ts` (or within configured settle window)
3. Pyth price account matches `pyth_price_feed` / feed id
4. `slot_now - pyth_publish_slot <= settle_max_staleness_slots`
5. `conf_ratio_bps = conf * 10_000 / |agg_price| <= settle_max_conf_ratio_bps`
6. Convert Pyth price → `settlement_price_e6` per [`units.md`](units.md)
7. Outcome: `SettledYes` if `settlement_price_e6 >= strike_price_e6`, else `SettledNo`

**Admin settle:** after `expiry_ts + admin_settle_delay_secs`, authority may set outcome + price without Pyth (emergency). Emits `AdminSettled`.

---

## 4. Fixed-point units (summary)

| Quantity | Scale | Type | Example |
| --- | --- | --- | --- |
| Collateral / USDC | 1e6 native | `u64` raw | `1_000_000` = $1 |
| Strike / settlement / Yes mid | `PRICE_SCALE = 1e6` | `u64` | Strike $180.50 → `180_500_000` |
| Outcome token amounts | mint decimals (=6) | `u64` | `1_000_000` Yes = one $1 claim if Yes wins |
| Fees | bps | `u16` | `10` = 0.10% |

Pyth `price` is `i64` with `expo` (typically `-8` for equities). Conversion:

```text
settlement_price_e6 = round_towards_zero( price * 10^(6 + expo) )
  when expo is negative: divide by 10^(-expo - 6) or multiply then divide carefully in u128
```

Full rules: [`units.md`](units.md).

---

## 5. Instruction flows

Account metas use Anchor-style names. `[]` = remaining optional.

### 5.1 `initialize_config`

**Accounts:** `authority` (signer), `config` (PDA init), `collateral_mint`, `treasury`, `system_program`, `rent`.

**State:** creates `Config`; `paused = false`.

**Event:** `ConfigInitialized`.

---

### 5.2 `create_strike_market`

**Accounts:** `authority` (signer, == config.authority), `config`, `strike_market` (PDA init), `yes_mint` (init), `no_mint` (init), `collateral_vault` (init), `vault_authority` (PDA), `collateral_mint`, `pyth_price_feed`, `phoenix_market` (optional unchecked at create — may be `Pubkey::default()` then set later), `token_program`, `system_program`, `rent`.

**Args:** `equity_symbol: [u8; 8]`, `strike_price_e6: u64`, `expiry_ts: i64`, `pyth_feed_id: [u8; 32]`, `phoenix_market: Pubkey`.

**State transitions:**

- `StrikeMarket.status = Open`
- `pairs_minted = pairs_redeemed = 0`
- Mints created with supply 0; mint authority = program PDAs

**Event:** `MarketCreated`.

---

### 5.3 `mint` (create Yes/No against collateral)

**Accounts:** `user` (signer), `config`, `strike_market`, `collateral_vault`, `vault_authority`, `user_collateral_ata`, `user_yes_ata`, `user_no_ata`, `yes_mint`, `no_mint`, `treasury` (if fee), `token_program`.

**Args:** `amount: u64` — raw outcome tokens to mint on **each** side (and collateral to lock ≈ `amount`, plus fee).

**Checks:**

- `!config.paused`
- `strike_market.status == Open`
- `clock.unix_timestamp < expiry_ts` (no mint after expiry)
- Vault receives `collateral_in = amount + fee(amount)` (fee definition: fee on collateral notional)

**State:**

- Transfer USDC user → vault (+ fee → treasury)
- Mint `amount` Yes → user
- Mint `amount` No → user
- `pairs_minted += amount`

**Invariant after:** `vault_balance >= (pairs_minted - pairs_redeemed)` in raw USDC (equality if fees never leave vault incorrectly).

**Event:** `Minted`.

---

### 5.4 `settle` (resolve via Pyth)

**Accounts:** `anyone` (signer, permissionless), `config`, `strike_market`, `pyth_price_feed` (must match market), `clock`.

**Args:** none (or optional `expected_feed_id` for safety).

**Checks:** Pyth accept rules in §3; `status == Open`.

**State:**

- Write `settlement_price_e6`, `settled_at_ts`, `settled_slot`
- `status = SettledYes | SettledNo`
- **Do not** move vault funds at settle; redeem pulls collateral

**Event:** `Settled`.

---

### 5.5 `admin_settle`

**Accounts:** `authority` (signer), `config`, `strike_market`, `clock`.

**Args:** `settlement_price_e6: u64`, `outcome_yes: bool`.

**Checks:** `now >= expiry_ts + admin_settle_delay_secs`; `status == Open` (or failed settle retries exhausted — policy: Open only).

**Event:** `AdminSettled`.

---

### 5.6 `redeem` (burn winning side for collateral)

**Accounts:** `user` (signer), `config`, `strike_market`, `collateral_vault`, `vault_authority`, `user_collateral_ata`, `user_winning_ata`, `winning_mint` (Yes or No per status), `treasury` (if fee), `token_program`.

**Args:** `amount: u64` — winning tokens to burn.

**Checks:**

- `status` is `SettledYes` or `SettledNo`
- `winning_mint` matches winning side
- Burn `amount` from user; transfer `amount - redeem_fee` USDC vault → user

**State:** `pairs_redeemed += amount`

**Losing tokens:** burnable via optional `burn_losing` (no payout) for UX cleanup — recommend include as separate ix.

**Event:** `Redeemed`.

---

### 5.7 `pause` / `unpause` / `update_config` / `set_phoenix_market`

Standard admin ix set. Emit `ConfigUpdated` or `PhoenixMarketSet`.

---

## 6. Events (Anchor)

Indexers should subscribe to these. All include `market` where applicable.

### `MarketCreated`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `market_id` | `u64` |
| `equity_symbol` | `[u8; 8]` |
| `strike_price_e6` | `u64` |
| `expiry_ts` | `i64` |
| `yes_mint` | `Pubkey` |
| `no_mint` | `Pubkey` |
| `collateral_vault` | `Pubkey` |
| `phoenix_market` | `Pubkey` |
| `pyth_price_feed` | `Pubkey` |

### `Minted`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `user` | `Pubkey` |
| `amount` | `u64` |
| `collateral_locked` | `u64` |
| `fee` | `u64` |
| `pairs_minted_after` | `u64` |

### `Settled`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `settlement_price_e6` | `u64` |
| `strike_price_e6` | `u64` |
| `outcome_yes` | `bool` |
| `pyth_conf` | `u64` |
| `slot` | `u64` |
| `ts` | `i64` |

### `AdminSettled`

Same as `Settled` plus `authority: Pubkey`.

### `Redeemed`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `user` | `Pubkey` |
| `amount` | `u64` |
| `collateral_paid` | `u64` |
| `fee` | `u64` |
| `pairs_redeemed_after` | `u64` |

### `ConfigUpdated`

| Field | Type |
| --- | --- |
| `authority` | `Pubkey` |
| `paused` | `bool` |
| `mint_fee_bps` | `u16` |
| `redeem_fee_bps` | `u16` |
| `settle_max_staleness_slots` | `u64` |
| `settle_max_conf_ratio_bps` | `u16` |
| `admin_settle_delay_secs` | `u64` |

### `PhoenixMarketSet`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `phoenix_market` | `Pubkey` |
| `phoenix_base_mint` | `Pubkey` |
| `phoenix_quote_mint` | `Pubkey` |

---

## 7. Invariants

1. **Binary $1 payout:** Winning token redeems 1:1 for 1 USDC raw unit per token raw unit (decimals aligned). Yes + No positions from the same mint are complementary; a full pair is always fully collateralized at $1 until redeem.
2. **Supply:** While `status == Open`, `yes_mint.supply == no_mint.supply == pairs_minted - (burns if any)`. No unpaired mints.
3. **Vault:** `collateral_vault.amount >= (pairs_minted - pairs_redeemed) - accounting_for_fees_already_sent_to_treasury`. Prefer fee-on-transfer-in so vault always holds exactly outstanding liability.
4. **Settlement immutability:** Once `SettledYes` / `SettledNo` / `Void`, outcome fields do not change.
5. **Pause:** `paused` blocks `mint` and `create_strike_market`; `settle` / `redeem` remain available.
6. **Non-custodial:** Vaults are PDAs owned/authorized by the Meridian program; users retain SPL token custody of Yes/No until they trade or redeem. Phoenix holds no Meridian admin keys.
7. **Phoenix isolation:** Matching / cancels / fees on Phoenix are out of Meridian state; only mint linkage is stored.

---

## 8. Open questions (non-blocking defaults)

| Topic | Default in this doc | Open |
| --- | --- | --- |
| Phoenix base mint side | **Yes mint** as base, USDC quote | Could use No as base; UI mapping changes |
| Exact Pyth equity product / feed ids for MAG7 | Placeholder per-market `pyth_feed_id` | Pin mainnet/devnet feed accounts before deploy |
| Strike comparison | Yes wins if `settle >= strike` | Confirm Peak6 wants `>` vs `>=` on exact touch |
| `equity_symbol` encoding | `[u8; 8]` space-padded ASCII | vs separate `AssetRegistry` PDA |
| StrikeMarket PDA seeds | `(symbol, expiry_ts, strike_e6)` | vs monotonic `market_id` only |
| Losing-token burn ix | Recommended `burn_losing` | Optional for v1 |
| Protocol fees | Fields present; **default 0 bps** | Product may keep fees off for platinum demo |
| Settle window | Any time after `expiry_ts` with fresh Pyth | Automation retries 15m / 30s per PRD |
| Multi-collateral | Single `collateral_mint` on Config | Out of scope v1 |

---

## 9. Related

- Field-level expansion: [`accounts.md`](accounts.md)
- Sequences: [`flows.md`](flows.md)
- Pyth math: [`units.md`](units.md)
- Scaffold map: [`../programs/meridian/README.md`](../programs/meridian/README.md)
