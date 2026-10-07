# Meridian On-Chain Schema

Primary reference for Anchor account layouts, PDA seeds, Phoenix linkage, Pyth settlement refs, fixed-point units, instruction flows, events, and invariants.

Companion docs: [`accounts.md`](accounts.md) · [`flows.md`](flows.md) · [`units.md`](units.md) · [`sim-clock.md`](sim-clock.md) · [`../programs/meridian/README.md`](../programs/meridian/README.md)

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
| `paused` | `bool` | 1 | Global pause: blocks mint / create / **merge_pair**; settle+redeem may still run (policy: settle always allowed) |
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

**Lifecycle / mint window (no session status):** Meridian does **not** add a StrikeMarket status for exchange session open/close. Lifecycle remains `Open` → `SettledYes|SettledNo|Void` (`Settling` = unused/reserved, X-07). **"Market open"** (mint window) = `status == Open && !paused && effective_now < expiry_ts`. **"Market close"** (mint ends) = `effective_now >= expiry_ts`. **`merge_pair`** allowed whenever `status == Open && !paused` — **including after expiry** (no mint after expiry; merge still OK until settle). Phoenix trading hours are out of Meridian. Localnet time simulation: [`sim-clock.md`](sim-clock.md) (**D-017**). Config gains **no** sim fields — SimClock is a separate PDA behind `localnet-test` only.

---

### 1.2 `StrikeMarket` (one strike / outcome market)

One account per `(equity, expiry_day, strike)`. Holds Pyth + Phoenix wiring and settlement state.

| Field | Type | Size | Notes |
| --- | --- | --- | --- |
| `config` | `Pubkey` | 32 | Parent `Config` |
| `market_id` | `u64` | 8 | Monotonic id from config counter (optional convenience) |
| `equity_symbol` | `[u8; 8]` | 8 | ASCII, right-padded spaces; e.g. `AAPL\0\0\0\0` or space-pad — **default: space-pad** |
| `pyth_price_feed` | `Pubkey` | 32 | Solana Pyth price account for this equity (V1 MAG7 registry §3; or mock under `localnet-test`) |
| `pyth_feed_id` | `[u8; 32]` | 32 | 32-byte Pyth Core feed id (no `0x` prefix in hex form); must match Hermes / price account; useful for indexers |
| `strike_price_e6` | `u64` | 8 | Strike in `PRICE_SCALE` (1e6). Yes wins if settle ≥ strike (**default: ≥**) |
| `expiry_ts` | `i64` | 8 | Unix seconds; target ~16:00 ET close window |
| `yes_mint` | `Pubkey` | 32 | SPL mint for Yes tokens (decimals = collateral decimals) |
| `no_mint` | `Pubkey` | 32 | SPL mint for No tokens |
| `collateral_vault` | `Pubkey` | 32 | Token account PDA holding USDC |
| `phoenix_market` | `Pubkey` | 32 | Phoenix market account pubkey |
| `phoenix_base_mint` | `Pubkey` | 32 | **Default: `yes_mint`** |
| `phoenix_quote_mint` | `Pubkey` | 32 | **Default: `collateral_mint` (USDC)** |
| `status` | `u8` | 1 | `0=Open`, `1=Settling` (**unused / reserved** — X-07; do not transition into), `2=SettledYes`, `3=SettledNo`, `4=Void` (admin). State machine: **Open → SettledYes / SettledNo / Void** only |
| `pairs_minted` | `u64` | 8 | While `status == Open`: **outstanding pair liability** (raw token amount). **+mint / −merge_pair**. After settle, frozen at last outstanding; redeem uses `pairs_redeemed` |
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
- **Holds:** USDC equal to outstanding unredeemed liability. While Open: ≈ `pairs_minted` (each outstanding pair is $1 collateral). After settle: ≈ `pairs_minted - pairs_redeemed` (minus fees already skimmed to treasury)

| Concept | PDA seeds |
| --- | --- |
| Vault authority | `["vault_authority", strike_market.key().as_ref()]` |
| Settlement vault (optional alias) | Same PDA; Meridian uses one collateral vault per market. No separate settlement vault unless fees need isolation. |

**Default:** single `collateral_vault` per `StrikeMarket`. Fees (if `mint_fee_bps` / `redeem_fee_bps` > 0) transfer to `Config.treasury` at mint / **merge_pair** / redeem time — not held in market vault. `merge_pair` uses `redeem_fee_bps` (fee-on-payout, same path as redeem).

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

### 1.5 `SimClock` (localnet-test only — D-017)

**Deploy blocker:** account + ixs compile only under `#[cfg(feature = "localnet-test")]`. Absent from prod `.so` / prod IDL. Same pattern as `upsert_mock_pyth` / `test_drain_vault`. Full proposal: [`sim-clock.md`](sim-clock.md).

| Field | Type | Size | Notes |
| --- | --- | --- | --- |
| `authority` | `Pubkey` | 32 | Must equal `Config.authority` |
| `unix_timestamp` | `i64` | 8 | Simulated `Clock.unix_timestamp` |
| `slot` | `u64` | 8 | Simulated `Clock.slot` (Pyth staleness under sim) |
| `enabled` | `bool` | 1 | If false → fall back to `Clock::get()` |
| `bump` | `u8` | 1 | PDA bump |

**PDA seeds:**

```text
["sim_clock"]
```

**Approx space:** `8` + `50` → allocate `64`.

**Role:** When `localnet-test` and account present and `enabled`, `effective_clock` returns sim ts/slot for mint / settle / admin_settle (and Pyth `slot_now`). Production builds never read this account.

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

**Field roles:** `StrikeMarket.pyth_feed_id` stores the **32-byte Pyth Core feed id**. `StrikeMarket.pyth_price_feed` stores the **Solana price account** pubkey from the V1 MAG7 registry below (prod/devnet), or a mock price account under `localnet-test`.

### 3.1 V1 MAG7 registry (D-019)

SPEC MAG7 symbols: **AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA** (Alphabet = **GOOGL** Class A, not GOOG Class C).

Pyth Core stable feed ids from Hermes `Equity.US.*/USD` (hex, **no `0x` prefix**). Solana mainnet/devnet **shard-0** push-feed price accounts are PDAs of Price Feed program `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` (seeds = `u16le` shard `0` + feed_id bytes). All seven **exist** on mainnet; owner = receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`; account space **134**. Same shard-0 PDAs apply on solana **mainnet and devnet** for these sponsored feeds under the **current** Price Feed program.

| Symbol | Pyth symbol | `pyth_feed_id` (32-byte hex) | `pyth_price_feed` (mainnet/devnet) |
| --- | --- | --- | --- |
| AAPL | `Equity.US.AAPL/USD` | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` | `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy` |
| MSFT | `Equity.US.MSFT/USD` | `d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1` | `7VYuuJxz8w2rLA9tJG2KZ9T1fSMcjC7uECoYA6nDaqtK` |
| GOOGL | `Equity.US.GOOGL/USD` | `5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6` | `HShKFQqhYkUiXpVyyLmrAALXwWqHB7ikLmPbrwJzpRNh` |
| AMZN | `Equity.US.AMZN/USD` | `b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a` | `GBkjjFxbaFY9TBHpAPypk5JBchpPPve2jskAcd9zuFNd` |
| META | `Equity.US.META/USD` | `78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe` | `GsKrMNoa1Mqjpif4SYk2WjdduWZP699hXRdP51yBM6K2` |
| NVDA | `Equity.US.NVDA/USD` | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` | `2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC` |
| TSLA | `Equity.US.TSLA/USD` | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | `E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ` |

**Upgrade caveat:** Pyth Core upgrade program `pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou` would change PDAs. Upgraded accounts were **missing** on mainnet as of **2026-10-07** — V1 pins the **current** Price Feed program accounts above. **Re-derive and re-pin after any Pyth upgrade.**

**Footnote (not V1 MAG7):** GOOG Class C feed `e65ff435be42630439c96396653a342829e877e2aafaeaf1a10d0ee5fd2cf3f2` exists on Hermes; SPEC uses **GOOGL** — do **not** include GOOG in the V1 set unless Debu overrides.

**Sources:** Hermes `https://hermes.pyth.network/v2/price_feeds`; Pyth docs push-feeds / PDA derivation; mainnet RPC `getAccountInfo` verified 2026-10-07.

**Accept settle iff:**

1. `status == Open` (`Settling` is unused/reserved — do not accept Settling)
2. `effective_clock.unix_timestamp >= expiry_ts` (or within configured settle window); see §5.0 / [`sim-clock.md`](sim-clock.md)
3. Pyth price account matches `pyth_price_feed` / feed id
4. `slot_now - pyth_publish_slot <= settle_max_staleness_slots`
5. `conf_ratio_bps = conf * 10_000 / |agg_price| <= settle_max_conf_ratio_bps`
6. Convert Pyth price → `settlement_price_e6` per [`units.md`](units.md)
7. Outcome: `SettledYes` if `settlement_price_e6 >= strike_price_e6`, else `SettledNo`

**Admin settle:** after `expiry_ts + admin_settle_delay_secs`, authority may set outcome + price without Pyth (emergency). **Policy A (A-05):** `outcome_yes` must equal `(settlement_price_e6 >= strike_price_e6)` else `OutcomeInconsistent`. Emits `AdminSettled`.

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

### 5.0 `effective_clock` (time gates)

`mint`, `settle`, and `admin_settle` (and any future time/slot gate) use an **`effective_clock`** helper — not raw `Clock::get()` alone when sim is active:

| Build | Source |
| --- | --- |
| Production | `Clock::get()` only (no SimClock types) |
| `localnet-test` | If `sim_clock: Option<Account<SimClock>>` is `Some` **and** `enabled` → sim `unix_timestamp` / `slot`; else `Clock::get()` |

**Preferred Anchor shape (localnet-test):** add `sim_clock: Option<Account<SimClock>>` on Mint / Settle / AdminSettle contexts. Tests that skip init omit the account. See [`sim-clock.md`](sim-clock.md).

`settled_at_ts` / `settled_slot` record the **effective** values used at settle (deterministic under warp).

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

**Accounts:** `user` (signer), `config`, `strike_market`, `collateral_vault`, `vault_authority`, `user_collateral_ata`, `user_yes_ata`, `user_no_ata`, `yes_mint`, `no_mint`, `treasury` (if fee), `token_program`[, `sim_clock` optional under `localnet-test`].

**Args:** `amount: u64` — raw outcome tokens to mint on **each** side (and collateral to lock ≈ `amount`, plus fee).

**Checks:**

- `!config.paused`
- `strike_market.status == Open`
- `effective_clock.unix_timestamp < expiry_ts` (no mint after expiry; localnet may use SimClock — D-017)
- Vault receives `collateral_in = amount + fee(amount)` (fee definition: fee on collateral notional)

**State:**

- Transfer USDC user → vault (+ fee → treasury)
- Mint `amount` Yes → user
- Mint `amount` No → user
- `pairs_minted += amount` (outstanding pair liability; see §5.3.1 `merge_pair` for −)

**Invariant after:** while Open, `yes.supply == no.supply == pairs_minted`; vault covers outstanding pairs.

**Event:** `Minted`.

**Symmetry:** `merge_pair` is the Open-state inverse (burn Yes+No, return collateral, decrement `pairs_minted`).

---

### 5.3.1 `merge_pair` (PROD — inverse of mint while Open)

Atomic unwind of a Yes+No pair **before settle**. Inverse of `mint`. **Not** localnet-test gated — ships in prod IDL.

**Distinct from:**
- `burn_losing` — post-settle, losing side only, **no** USDC payout
- `redeem` — post-settle, winning side, USDC payout

**Accounts:** mirror `mint` — `user` (signer), `config`, `strike_market`, `collateral_vault`, `vault_authority`, `user_collateral_ata`, `user_yes_ata`, `user_no_ata`, `yes_mint`, `no_mint`, `treasury` (if fee), `token_program`.

**Args:** `amount: u64` — raw outcome tokens to burn on **each** side (Yes and No).

**Checks:**
- `amount > 0` else `ZeroAmount`
- `!config.paused` else `Paused` — **pause blocks merge like mint** (and create)
- `strike_market.status == Open` else `MarketNotOpen`
- **No expiry gate:** allow merge while Open **even after** `expiry_ts` (user may unwind Yes+No before settle). Contrast with `mint`, which requires `effective_now < expiry_ts`
- `collateral_vault.amount >= amount` else `InsufficientVault` (require before transfers; fee also comes from vault)
- Fee math in `u128`; overflow → `MathOverflow`
- Token burns of Yes and No must succeed (token program / balance failures)

**Fee (fee-on-payout, same path as `redeem`):**
```text
fee = amount * redeem_fee_bps / 10_000   // default redeem_fee_bps = 0
collateral_out = amount - fee
```
Fee → `Config.treasury` from vault; `collateral_out` → user.

**State:**
- Burn `amount` Yes from `user_yes_ata`
- Burn `amount` No from `user_no_ata`
- Transfer `collateral_out` USDC vault → user
- Transfer `fee` USDC vault → treasury (if fee > 0)
- `pairs_minted -= amount` (outstanding pair liability)

**Invariant after:** while Open, `yes.supply == no.supply == pairs_minted`; vault covers outstanding pairs.

**Event:** `Merged { market, user, amount, fee, pairs_minted_after }`.

**Client composition (D-018 / UI 06):** Meridian does **not** wrap Phoenix in one program ix.
- **Buy No:** client `mint` + Phoenix ask Yes @ `1 − p_no` (shipped Eng !28)
- **Sell No:** client Phoenix bid Yes @ `1 − p_no`, then **`merge_pair`** (same tx when fill is immediate; resting = bid only, merge on fill)
- Transient Yes+No inside one tx is OK per UI 06 §1

---

### 5.4 `settle` (resolve via Pyth)

**Accounts:** `anyone` (signer, permissionless), `config`, `strike_market`, `pyth_price_feed` (must match market)[, `sim_clock` optional under `localnet-test`].

**Args:** none (or optional `expected_feed_id` for safety).

**Checks:** Pyth accept rules in §3 (staleness uses `effective_clock.slot`); `status == Open`; `effective_clock.unix_timestamp >= expiry_ts`.

**State:**

- Write `settlement_price_e6`, `settled_at_ts`, `settled_slot` (effective clock values)
- `status = SettledYes | SettledNo`
- **Do not** move vault funds at settle; redeem pulls collateral

**Event:** `Settled`.

---

### 5.5 `admin_settle`

**Accounts:** `authority` (signer), `config`, `strike_market`[, `sim_clock` optional under `localnet-test`].

**Args:** `settlement_price_e6: u64`, `outcome_yes: bool`.

**Checks:**
- `effective_clock.unix_timestamp >= expiry_ts + admin_settle_delay_secs`
- `status == Open` (policy: Open only; `Settling` unused — do not accept)
- **Policy A (A-05):** require `outcome_yes == (settlement_price_e6 >= strike_price_e6)` else error `OutcomeInconsistent`. Authority cannot assert Yes while price is below strike (or No while at/above).

**State:** write `settlement_price_e6`, `settled_at_ts`, `settled_slot`; `status = SettledYes | SettledNo` per `outcome_yes`.

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

Standard admin ix set. Emit `ConfigUpdated` or `PhoenixMarketSet`. Pause remains orthogonal to SimClock: blocks **mint / create / merge_pair**; settle+redeem still allowed.

---

### 5.8 SimClock ixs (`localnet-test` only — D-017)

All `#[cfg(feature = "localnet-test")]`. Full detail: [`sim-clock.md`](sim-clock.md).

| Instruction | Args | Behavior |
| --- | --- | --- |
| `init_sim_clock` | — | Create `["sim_clock"]` PDA; `enabled=true`; seed ts/slot from wall `Clock::get()` once; `authority = config.authority` |
| `set_sim_clock` | `unix_timestamp: i64`, `slot: u64` | Authority; requires `enabled`; overwrite ts/slot |
| `warp_sim_clock` | `add_secs: i64`, `add_slots: u64` | Authority; saturating/checked add on ts/slot |
| `disable_sim_clock` | — | Optional; `enabled=false` → fall back to `Clock::get()` |

**Event:** `SimClockSet` (cfg localnet-test only).

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


### `Merged`

| Field | Type |
| --- | --- |
| `market` | `Pubkey` |
| `user` | `Pubkey` |
| `amount` | `u64` |
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

### `SimClockSet` (`localnet-test` only)

| Field | Type |
| --- | --- |
| `unix_timestamp` | `i64` |
| `slot` | `u64` |
| `authority` | `Pubkey` |

---

## 7. Invariants

1. **Binary $1 payout:** Winning token redeems 1:1 for 1 USDC raw unit per token raw unit (decimals aligned). Yes + No positions from the same mint are complementary; a full pair is always fully collateralized at $1 until redeem.
2. **Supply:** While `status == Open`, `yes_mint.supply == no_mint.supply == pairs_minted`. No unpaired mints. (`pairs_minted` = outstanding pair liability: +mint / −merge_pair.)
3. **Vault:** `collateral_vault.amount >= (pairs_minted - pairs_redeemed) - accounting_for_fees_already_sent_to_treasury`. Prefer fee-on-transfer-in so vault always holds exactly outstanding liability.
4. **Settlement immutability:** Once `SettledYes` / `SettledNo` / `Void`, outcome fields do not change.
5. **Pause:** `paused` blocks `mint`, `create_strike_market`, and `merge_pair`; `settle` / `redeem` remain available.
6. **Non-custodial:** Vaults are PDAs owned/authorized by the Meridian program; users retain SPL token custody of Yes/No until they trade or redeem. Phoenix holds no Meridian admin keys.
7. **Phoenix isolation:** Matching / cancels / fees on Phoenix are out of Meridian state; only mint linkage is stored.

---

## 8. Open questions / V1 lock inventory

Status of prior §8 topics for **V1**. Defaults below are what Engineers should ship unless Debu overrides.

| Topic | V1 status | Notes |
| --- | --- | --- |
| Phoenix Yes base | **Locked D-004 / D-015** | Yes mint = base; USDC = quote |
| MAG7 Pyth feeds | **Proposed lock D-019** | Exact feed ids + shard-0 price accounts in §3.1 |
| Strike comparison | **Locked D-005** (`>=`); product confirm | Propose **close** this §8 open — keep `settle >= strike`. Flag Debu only if Peak6 wants strict `>` on exact touch |
| `equity_symbol` `[u8; 8]` space-pad | **V1 default OK** | No Debu lock unless they want `AssetRegistry` |
| StrikeMarket PDA seeds `(symbol, expiry, strike)` | **V1 default OK** | `market_id` remains convenience field |
| `burn_losing` | **V1 optional OK** | Recommended; not required for demo path |
| `merge_pair` / Sell No | **Locked D-018** | Prod ix; client composes Phoenix |
| `Settling` status | **Locked D-018 / X-07** | Unused/reserved |
| `admin_settle` Policy A | **Locked D-018 / A-05** | `outcome_yes` must match `price >= strike` |
| Protocol fees default 0 | **V1 OK** | Fields present; demo may keep 0 bps |
| Settle window | **V1 OK** | Any time after `expiry_ts` with fresh Pyth; automation retries per PRD |
| Multi-collateral | **Out of scope V1** | Single `collateral_mint` on Config |

### Needs Debu lock

1. **Merge D-019** — pin V1 MAG7 Pyth Core feed ids + shard-0 Solana price accounts (§3.1); Alphabet = GOOGL.
2. **Confirm keep `>=`** (D-005) vs Peak6 strict `>` on exact touch — only if still product-open; Schema proposes leave D-005 as-is and close the §8 row.

---

## 9. Related

- Field-level expansion: [`accounts.md`](accounts.md)
- Sequences: [`flows.md`](flows.md)
- Pyth math: [`units.md`](units.md)
- Localnet time sim (D-017): [`sim-clock.md`](sim-clock.md)
- Scaffold map: [`../programs/meridian/README.md`](../programs/meridian/README.md)
- Decisions index: [`DECISIONS.md`](DECISIONS.md)
