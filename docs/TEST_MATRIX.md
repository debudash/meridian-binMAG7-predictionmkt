# Meridian Test Matrix — Mint / Settle / Redeem + $1 Vault

**Status:** P0/P1/SIM + Cluster I (`merge_pair`) green on `main` (68/68 localnet post-!31). **P2 cluster + INV gates** = `tests/p2_gates.ts` — TDD until Eng pins A-05 / X-07 (D-018 Policy A / Settling retire).  
**Audience:** Meridian Testers → Anchor/TS integration tests.  
**Stack:** Solana + Anchor; Phoenix CLOB (integrate, no matching in Meridian); Pyth equity closes; USDC collateral; MAG7 binary Yes/No.  
**Program id (tip):** `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` (post !24 rotate; suite confirm !25). Revoked: `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2`.

**Coordination:** A-05 Policy A + X-07 Settling retire covered by P2 suite !27; Schema !29 docs align — **do not double-flip** those cases in this MR.
**Audience:** Meridian Testers → Anchor/TS integration tests.  
**Stack:** Solana + Anchor; Phoenix CLOB (integrate, no matching in Meridian); Pyth equity closes; USDC collateral; MAG7 binary Yes/No.  
**Program id (tip):** `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` (post !24 rotate; suite confirm !25). Revoked: `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2`.

**Source of truth (docs on `main`):**
- [`SCHEMA.md`](SCHEMA.md) §§5–7 (instructions, events, invariants)
- [`flows.md`](flows.md) §§2–5, §7 (mint / settle / redeem / pause)
- [`accounts.md`](accounts.md) (status machine, writers, vault PDA)
- [`units.md`](units.md) (fee math, Pyth→e6, payout identity, test vectors)
- [`DECISIONS.md`](DECISIONS.md) D-003…D-006, D-015, **D-017** (anytime sim), **D-018** (`merge_pair` / Sell No)
- [`../programs/meridian/README.md`](../programs/meridian/README.md) (scaffold test plan + errors)

**TDD note:** When program scaffolding exists, translate **P0** rows into failing Anchor/TS tests first; do not implement product logic in the same change as this matrix.

---

## How to read columns

| Column | Meaning |
| --- | --- |
| Case ID | Stable id (`M-##` mint, `S-##` settle, `A-##` admin settle, `R-##` redeem, `V-##` vault/invariant, `X-##` cross-phase / pause, `SIM-##` localnet simulated session, `MP-##` merge_pair / D-018) |
| Phase | `mint` / `settle` / `admin_settle` / `redeem` / `invariant` / `pause` / `sim_session` (localnet-only) / `merge_pair` |
| Precondition | Market + config state before the action |
| Action | Instruction + key args |
| Expected | On-chain status, vault USDC, Yes/No supplies & user balances, counter fields |
| Oracle/Phoenix notes | Pyth fixtures / Phoenix isolation (no Meridian CPI for trades) |
| Priority | **P0** must-gate platinum demo; **P1** important; **P2** nice / optional ix |
| Status | `draft` until code exists → then `pending code` / `failing` / `passing` |

Amounts are **raw u64** with decimals = 6 unless noted (`1_000_000` = $1 = 1 full outcome token).

---

## Shared fixtures (for later Anchor/TS)

| Fixture | Value |
| --- | --- |
| Collateral | Fixture mint, 6 decimals (stand-in for USDC) |
| `PRICE_SCALE` | `1_000_000` |
| Default fees | `mint_fee_bps = 0`, `redeem_fee_bps = 0` (D-006); fee cases override |
| Strike | e.g. `180_000_000` ($180.00) |
| Equity symbol | space-padded `[u8; 8]` e.g. `AAPL#ifdef` |
| Staleness / conf | Config defaults: `150` slots, `500` bps (D-005) |
| Admin delay | `admin_settle_delay_secs = 1800` unless case overrides |
| Pyth expo | Prefer `-8` equity-style; see `units.md` §8 vectors |
| Phoenix | Store pubkey + assert base=Yes / quote=USDC when set; **no** place/fill assertions inside Meridian tests. **Sim trade** = mint + off-book SPL Yes transfer (or future Phoenix CPI mock) — never a Meridian matching engine |

**Invariant helpers (assert after every happy path and after redeem batches):**

```text
I1  Binary $1: redeem(amount) with fee=0 → collateral_out == amount
I2  Supply (status==Open): yes_mint.supply == no_mint.supply == pairs_minted  (+mint / −merge_pair; absent unpaired burns)
I3  Vault: collateral_vault.amount >= (pairs_minted - pairs_redeemed)
    Prefer equality when fees skim to treasury at mint/redeem (fee-on-transfer-in)
I4  Settlement immutability: SettledYes|SettledNo|Void → settle/admin_settle must fail; fields frozen
I5  Pause: blocks mint + create_strike_market + **merge_pair**; settle + redeem still succeed
```

Cite: SCHEMA §7; flows §2/§5/§7; units §3.

---

## Cluster A — Mint

**Doc cites:** SCHEMA §5.3, §7.2–7.3; flows §2; units §3; accounts writers (`pairs_minted`); README errors `Paused`, `MarketNotOpen`, `MintAfterExpiry`.

| Case ID | Phase | Precondition | Action | Expected (on-chain / vault / balances) | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M-01 | mint | Market `Open`; `!paused`; `now < expiry_ts`; fees 0; user has ≥ `amount` USDC | `mint(amount=1_000_000)` | User: −1e6 USDC, +1e6 Yes, +1e6 No; vault += 1e6; `pairs_minted += 1e6`; Yes.supply == No.supply == pairs_minted; emit `Minted` | Phoenix unused | P0 | draft |
| M-02 | mint | Same as M-01; prior mint already done | `mint(amount=2_500_000)` | Cumulative `pairs_minted` correct; vault == pairs_minted; supplies equal | — | P0 | draft |
| M-03 | mint | `mint_fee_bps = 10` (0.10%) | `mint(amount=1_000_000)` | User pays `collateral_in = amount + fee` with `fee = amount * 10 / 10_000`; vault += `amount` only; treasury += `fee`; pairs/supplies += `amount` | Fee never left in vault | P1 | draft |
| M-04 | mint | `config.paused == true` | `mint(...)` | Fail `Paused`; vault/supplies/`pairs_minted` unchanged | — | P0 | draft |
| M-05 | mint | `status != Open` (e.g. already `SettledYes`) | `mint(...)` | Fail `MarketNotOpen`; no token mint | — | P0 | draft |
| M-06 | mint | `now >= expiry_ts`, still `Open` | `mint(...)` | Fail `MintAfterExpiry` | Clock warp | P0 | draft |
| M-07 | mint | `amount = 0` | `mint(0)` | Fail (reject zero) or no-op with no state change — **pin in impl**; prefer hard reject | — | P1 | draft |
| M-08 | mint | User USDC < required `collateral_in` | `mint(...)` | Token transfer fails / insufficient funds; no partial mint (Yes/No not minted) | — | P0 | draft |
| M-09 | mint | Missing Yes or No ATA | `mint(...)` | Fail account constraint; no vault debit | Client checklist flows §8 | P1 | draft |
| M-10 | mint | Two users mint into same market | sequential `mint` | `pairs_minted` sums; vault covers sum; each user holds own Yes/No | Multi-wallet | P1 | draft |

---

## Cluster B — Settle (Pyth)

**Doc cites:** SCHEMA §3, §5.4, §7.4; flows §4; units §§4–5, §8; D-005; README errors `ExpiryNotReached`, `StalePythPrice`, `PythConfidenceTooWide`, `InvalidPythPrice`, `InvalidPythAccount`.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | settle | `Open`; `now >= expiry_ts`; Pyth fresh; `price_e6 >= strike` | permissionless `settle` | `status = SettledYes`; `settlement_price_e6` written; `settled_at_ts` / `settled_slot` set; **vault unchanged**; emit `Settled` `outcome_yes=true` | Fixture: expo −8 → e6 per units §8 | P0 | draft |
| S-02 | settle | Same; `price_e6 < strike` | `settle` | `status = SettledNo`; vault unchanged | — | P0 | draft |
| S-03 | settle | `settlement_price_e6 == strike_price_e6` | `settle` | `SettledYes` (`>=` default, D-005 / SCHEMA §8) | Exact-touch | P0 | draft |
| S-04 | settle | `now < expiry_ts` | `settle` | Fail `ExpiryNotReached`; status stays `Open` | Clock | P0 | draft |
| S-05 | settle | Publish slot older than `settle_max_staleness_slots` | `settle` | Fail `StalePythPrice` | Slot warp vs Pyth account | P0 | draft |
| S-06 | settle | `conf * 10000 / price > settle_max_conf_ratio_bps` | `settle` | Fail `PythConfidenceTooWide` | Wide conf fixture | P0 | draft |
| S-07 | settle | Wrong Pyth account / feed id ≠ market | `settle` | Fail `InvalidPythAccount` | Mismatched account meta | P0 | draft |
| S-08 | settle | `price <= 0` or converted e6 == 0 | `settle` | Fail `InvalidPythPrice` | units §4.1, §8 row `price=1,expo=-8` | P1 | draft |
| S-09 | settle | Already `SettledYes` / `SettledNo` | `settle` again | Fail; settlement fields **immutable** (I4) | — | P0 | draft |
| S-10 | settle | Units vector table | unit-test `pyth_price_to_e6` only | Match units.md §8 expected e6 rows | No accounts | P0 | draft |
| S-11 | settle | Market has minted pairs; settle Yes | `settle` then inspect | Vault still == outstanding pairs; supplies unchanged at settle | Vault must not move at settle (SCHEMA §5.4) | P0 | draft |

---

## Cluster C — Admin settle

**Doc cites:** SCHEMA §5.5; flows §4 admin; accounts status machine; README `AdminSettleTooEarly`, `Unauthorized`.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | admin_settle | `Open`; `now >= expiry_ts + admin_settle_delay_secs`; authority signer | `admin_settle(price_e6, outcome_yes=true)` | Status/fields set; emit `AdminSettled`; vault unchanged | No Pyth required | P0 | draft |
| A-02 | admin_settle | Delay not elapsed | `admin_settle(...)` | Fail `AdminSettleTooEarly` | Clock | P0 | draft |
| A-03 | admin_settle | Non-authority signer | `admin_settle(...)` | Fail `Unauthorized` | — | P0 | draft |
| A-04 | admin_settle | Market already settled via Pyth | `admin_settle(...)` | Fail; cannot override (I4) | — | P0 | draft |
| A-05 | admin_settle | Authority sets `outcome_yes` inconsistent with `price_e6` vs strike | `admin_settle` | **PIN:** prefer **reject** (`OutcomeInconsistent` or pinned name) XOR **accept+log** + DECISIONS; suite asserts Policy A until Eng locks | Emergency path | P2 | failing |

---

## Cluster D — Redeem (+ optional burn losing)

**Doc cites:** SCHEMA §5.6, §7.1; flows §5; units §3; README `MarketNotSettled`, `InvalidWinningMint`, `InsufficientVault`.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | redeem | `SettledYes`; user holds Yes; fees 0 | `redeem(amount)` with Yes mint | Burn `amount` Yes; user USDC += `amount`; vault −=`amount`; `pairs_redeemed += amount`; emit `Redeemed` | Losing No remains until burn_losing | P0 | draft |
| R-02 | redeem | `SettledNo`; user holds No | `redeem` with No mint | 1:1 USDC; Yes not redeemable | — | P0 | draft |
| R-03 | redeem | `SettledYes`; pass No (losing) as winning mint | `redeem` | Fail `InvalidWinningMint` | — | P0 | draft |
| R-04 | redeem | Status still `Open` | `redeem` | Fail `MarketNotSettled` | — | P0 | draft |
| R-05 | redeem | `redeem_fee_bps = 10` | `redeem(amount)` | `fee = amount * 10 / 10000`; user gets `amount - fee`; treasury += fee from vault; `pairs_redeemed += amount` | Vault drops by full `amount` (user+treasury) | P1 | draft |
| R-06 | redeem | Partial redeem then remainder | two `redeem` calls | Counters/vault monotonic; final vault == `pairs_minted - pairs_redeemed` (fee=0) | — | P0 | draft |
| R-07 | redeem | Redeem more than user winning balance | `redeem` | Fail; vault unchanged | — | P0 | draft |
| R-08 | redeem | Optional `burn_losing(amount)` after settle | burn loser | Supply of loser ↓; **no** USDC; `pairs_redeemed` unchanged; vault I3 intact | Ix present on tip IDL | P2 | pending |
| R-09 | redeem | Full redeem of all winning supply (fee=0) | redeem all winners | Vault → 0 (ignoring dust); `pairs_redeemed == pairs_minted` | Multi-user aggregate | P0 | draft |

---

## Cluster E — $1 vault & supply invariants

**Doc cites:** SCHEMA §7.1–7.3, §1.3 vault; flows §2 invariant; units §3; README scaffold item 4.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-01 | invariant | Fresh market | create → assert | vault=0; pairs_minted=pairs_redeemed=0; supplies=0 | — | P0 | draft |
| V-02 | invariant | After M-01/M-02 path | assert helper | `vault.amount == pairs_minted - pairs_redeemed` (fees 0) | Core **$1 vault** | P0 | draft |
| V-03 | invariant | Open market mid-lifecycle | after each mint | `yes.supply == no.supply == pairs_minted` | I2 | P0 | draft |
| V-04 | invariant | Settled; before any redeem | assert | Vault still == outstanding pairs; settle did not skim | S-11 twin | P0 | draft |
| V-05 | invariant | After mix of redeems (fee=0) | assert | `vault == pairs_minted - pairs_redeemed`; never negative | — | P0 | draft |
| V-06 | invariant | Fees enabled (mint+redeem) | mint then settle then redeem | Vault holds liability only; fees only in treasury; `vault >= pairs_minted - pairs_redeemed` with equality if fee-on-transfer-in | SCHEMA §7.3 preferred equality | P1 | draft |
| V-07 | invariant | Attempt redeem that would under-collateralize (should be impossible) | hostile amounts / wrong CPI | Fail `InsufficientVault` or burn constraint; never pay unbacked USDC | Red-team adjacent | P1 | draft |
| V-08 | invariant | Phoenix fills move Yes between users | off-protocol Phoenix sim **or** skip | Meridian vault/`pairs_*` unchanged by trades; only mint/redeem move vault | Phoenix isolation SCHEMA §7.7; no Meridian CPI | P1 | draft |

---

## Cluster F — Pause & cross-phase lifecycle

**Doc cites:** SCHEMA §5.7, §7.5; flows §1, §7; accounts status machine (no exit from settled).

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| X-01 | pause | Running → `pause` | `mint` / `create_strike_market` | Both fail `Paused` | — | P0 | draft |
| X-02 | pause | Paused; market past expiry; valid Pyth | `settle` then `redeem` | Both **succeed** (I5) | — | P0 | draft |
| X-03 | pause | Paused; delay elapsed | `admin_settle` | Succeeds | — | P1 | draft |
| X-04 | lifecycle | End-to-end fee=0 | create → mint → (optional set_phoenix) → warp expiry → settle ≥strike → redeem Yes | Final vault 0 if all winners redeemed; supplies/counters consistent; events ordered | Happy path README scaffold #2 | P0 | draft |
| X-05 | lifecycle | End-to-end SettledNo | mint → settle <strike → redeem No | Same as X-04 with No winner | — | P0 | draft |
| X-06 | lifecycle | Mint → settle → second settle | — | Second settle fails (I4) | — | P0 | draft |
| X-07 | lifecycle | `Settling` status if implemented | treat like Open for reads; settle completes | Enum present, **unused** on tip — Eng pin treat-like-Open **or** retire | accounts.md status table | P2 | failing |

---


---

## Cluster G — Localnet simulated session lifecycle (D-017)

**Scope:** **localnet-only** / Cargo feature `localnet-test`. **Never required for mainnet / prod builds.**  
**Doc cites:** D-017; flows §1 (daily lifecycle wall-clock is **product** time — sim replaces 9:30/16:00 ET); SCHEMA §5–7; Phoenix isolation SCHEMA §7.7 / V-08.  
**Product intent:** Drive **open → trade → close → settle → redeem** in one continuous harness with **no wait** for real US equity hours. Prod/devnet keep real ≥4:00 PM ET settle gate + Pyth quality.

### Sim semantics (TDD contract for Engineers)

| Step | Meaning | **Not** |
| --- | --- | --- |
| **Simulated open** | Market/strike is open for **trading** (`trading_open=true` or equivalent). Authority/fixture ix under `localnet-test`. | Wall-clock 9:30 ET |
| **Trade** | Meridian does **not** match. Represent a sim trade as: (1) `mint` for inventory + (2) **off-book SPL transfer** of Yes (Phoenix placeholder / V-08 twin), **or** a future Phoenix CPI **mock** — never invent a matching engine in Meridian. | Phoenix place/fill internals |
| **Simulated close** | Trading window ends (`trading_open=false`). Blocks new mint (and any Meridian-gated trade entry). | Wall-clock 4:00 PM ET |
| **Settle** | Existing MockPyth / `upsert_mock_pyth` + permissionless `settle`, **or** `admin_settle` after delay — localnet fixtures only for forced YesWins/NoWins. | Mainnet Pyth bypass |
| **Redeem** | Existing `redeem` of winning mint; vault $1 invariants hold. | — |

**Default compatibility:** `create_strike_market` may leave `trading_open=true` (today's P0/P1 mint-after-create stays green). `sim_close_session` clears it; `sim_open_session` sets it. Prefer separate `trading_open: bool` (or status) so `MarketStatus::Open` settlement machine is unchanged.

**Feature gate:** `sim_open_session` / `sim_close_session` (names flexible) **must** be `#[cfg(feature = "localnet-test")]` like `upsert_mock_pyth` / `test_drain_vault`. Prod `anchor build` .so must omit them.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SIM-01 | sim_session | Market created; localnet-test | `sim_open_session` | `trading_open == true` (or equiv.); mint allowed | Not 9:30 ET | P0 | failing |
| SIM-02 | sim_session | SIM-01 open; fees 0 | `mint` + **sim trade** = off-book Yes SPL transfer to 2nd user | `pairs_*` / vault **unchanged** by transfer; Yes balances move (V-08 twin) | Phoenix placeholder only | P0 | failing |
| SIM-03 | sim_session | Trading open | `sim_close_session` | `trading_open == false`; trading window ended | Not 4:00 PM ET | P0 | failing |
| SIM-04 | sim_session | After sim close; before settle | `mint(...)` | Fail `TradingClosed` (or `MarketNotOpen`); vault/supplies unchanged | Negative: trade/mint after close | P0 | failing |
| SIM-05 | sim_session | Trading still open; expiry reached; valid MockPyth | `settle` | Fail `SessionNotClosed` (product requires close before settle) — **pin error name in impl** | If Engineers document settle-without-close allowed, update matrix + retire this row | P0 | failing |
| SIM-06 | sim_session | Full path fee=0 | open → mint → sim trade → close → MockPyth settle (≥strike) → redeem Yes | Final vault 0 if all winners redeemed; I1/I3 hold; **no wall-clock wait** for equity hours | Forced YesWins via MockPyth | P0 | failing |
| SIM-07 | sim_session | After close; SettledNo path | open → mint → close → MockPyth settle (<strike) → redeem No | Same vault invariants; No wins | Forced NoWins | P0 | failing |
| SIM-08 | sim_session | After close; admin path | open → mint → close → warp past `admin_settle_delay` → `admin_settle` → redeem | Settled via admin; vault invariants | Localnet; no Pyth required | P1 | failing |
| SIM-09 | sim_session | IDL / build | Inspect feature gate | `sim_*` present only when built with `localnet-test`; **absent** from prod `.so` / not required for mainnet | Deploy blocker twin of upsert_mock_pyth | P0 | failing |

### Mapping

| Path | Cases |
| --- | --- |
| `tests/sim_session.ts` | SIM-01…SIM-09 |
| `tests/helpers/harness.ts` | `simOpen` / `simClose` / `simTradeOffBook` / `assertTradingOpen` hooks (TDD_RED until IDL lands) |

**Run:** `yarn test` / `anchor test -- --features localnet-test` only. Do **not** gate CI mainnet builds on Cluster G.



## Cluster I — `merge_pair` (D-018 / Sell No unwind)

**Doc cites:** SCHEMA §5.3.1, §7; flows §2b–2c; accounts Open/`pairs_minted`; **D-018**.  
**Suite:** `tests/merge_pair.ts` + harness `mergePair` (prod IDL).  
**Scope:** Meridian tests **only** `merge_pair`. Client Sell No = Phoenix bid Yes then `merge_pair` — **do not** invent Phoenix matching (placeholder/off-book OK).  
**Coordination:** A-05 Policy A + X-07 Settling retire covered by P2 suite !27; Schema !29 docs align — do **not** re-test or flip those here.

| Case ID | Phase | Precondition | Action | Expected (on-chain / vault / balances) | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MP-01 | merge_pair | Market `Open`; `!paused`; fees 0; user holds ≥ `amount` Yes+No | `merge_pair(amount)` | Burn `amount` Yes+No; user USDC += `amount`; vault −=`amount`; `pairs_minted −= amount`; yes.supply == no.supply == pairs_minted; emit `Merged` | Phoenix unused | P0 | passing |
| MP-02 | merge_pair | `now >= expiry_ts`, still `Open`; prior mint | `mint` then `merge_pair` | Mint fails `MintAfterExpiry`; **merge succeeds** (no expiry gate) | Contrast mint gate | P0 | passing |
| MP-03 | merge_pair | `config.paused == true`; user holds pairs | `merge_pair(...)` | Fail `Paused`; vault/supplies/`pairs_minted` unchanged | Pause like mint | P0 | passing |
| MP-04 | merge_pair | Status `SettledYes` / `SettledNo` | `merge_pair(...)` | Fail `MarketNotOpen` | Post-settle use redeem | P0 | passing |
| MP-05 | merge_pair | `redeem_fee_bps = 10`; Open; holds pairs | `merge_pair(amount)` | `fee = amount * 10 / 10000`; user gets `amount − fee`; treasury += fee from vault; vault −= full `amount`; `pairs_minted −= amount` | Fee-on-payout twin of R-05 | P1 | passing |
| MP-06 | merge_pair | After partial merge (fee=0) | assert I2/I3 | `yes.supply == no.supply == pairs_minted`; vault == outstanding pairs | Vault liability holds | P0 | passing |
| MP-07 | merge_pair | `amount = 0` **or** insufficient Yes/No | `merge_pair` | Fail `ZeroAmount` / token burn; no partial state | Prefer hard reject | P1 | passing |
| MP-08 | merge_pair | Open then SettledYes | Open: `redeem` fails / `merge_pair` OK; Settled: `merge_pair` fails / `redeem` OK | Distinct from `redeem` / `burn_losing` (R-08 stays P2 !27) | No burn_losing here | P0 | passing |

### Mapping

| Path | Cases |
| --- | --- |
| `tests/merge_pair.ts` | MP-01…MP-08 |
| `tests/helpers/harness.ts` | `mergePair` → real prod `merge_pair` |
---

## Cluster H — Remaining invariant gates (P2 / post-path)

**Doc cites:** SCHEMA §7 I1–I5; units §3 fee trunc; D-017 / SIM-09 prod fixture omit; `scripts/assert-prod-no-fixtures.sh` (CI).  
**Suite:** `tests/p2_gates.ts`. Do **not** re-implement P0/P1/SIM. Do **not** duplicate the CI `.so` strings job — INV-PROD-01 is a mocha IDL-only twin.

| Case ID | Phase | Precondition | Action | Expected | Oracle/Phoenix notes | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INV-P2-I3 | invariant | SettledYes; user holds loser No | `burn_losing` then redeem Yes | I3 vault ≥ outstanding after burn; I1 redeem still 1:1; burn must not break vault | Companion R-08 | P2 | pending |
| INV-PROD-01 | invariant | Committed `idl/meridian.prod.json` | Parse prod IDL ix names | Fixture ixs (`sim_*`, `upsert_mock_pyth`, `test_drain_vault`, …) **absent**; localnet IDL may keep them | Mocha twin of CI assert; no `.so` strings | P2 | pending |
| INV-FEE-TRUNC | invariant | Fee bps=10; amount with residual | unit + mint(999) | `fee = amount * bps / 10_000` trunc toward 0; fee(999)=0 → treasury unchanged; vault += amount | Documents M-03/R-05 1-lamport edge | P2 | pending |

## Priority rollup (plan coverage)

| Phase | P0 | P1 | P2 | Total |
| --- | ---: | ---: | ---: | ---: |
| mint | 6 | 4 | 0 | 10 |
| settle | 9 | 1 | 0 | 10 |
| admin_settle | 4 | 0 | 1 | 5 |
| redeem | 7 | 1 | 1 | 9 |
| invariant | 5 | 3 | 0 | 8 |
| pause / lifecycle | 6 | 1 | 1 | 8 |
| sim_session (localnet) | 8 | 1 | 0 | 9 |
| merge_pair (D-018) | 6 | 2 | 0 | 8 |
| **Sum** | **51** | **13** | **3** | **67** |
| inv gates (Cluster H) | 0 | 0 | 3 | 3 |
| **Sum** | **45** | **11** | **6** | **62** |

*(S-10 counted under settle P0 as unit-testable without full program. SIM-* are **localnet-only** and never gate mainnet builds.)*

---

## Mapping to future test files (not created yet)

| Suggested path (when `tests/` exists) | Cases |
| --- | --- |
| `tests/unit/pyth_price_to_e6.ts` (or Rust `utils/pyth`) | S-10 + units §8 |
| `tests/mint.ts` | M-* |
| `tests/settle.ts` | S-* (excl. pure unit), A-* |
| `tests/redeem.ts` | R-* |
| `tests/invariants.ts` | V-* asserted as postconditions + X-04/X-05 |
| `tests/pause.ts` | X-01…X-03 |
| `tests/sim_session.ts` | SIM-01…SIM-09 (**localnet-test only**) |
| `tests/merge_pair.ts` | MP-01…MP-08 (**D-018**; green) |

P0/P1/SIM suites green on `main` (localnet). Cluster I (`merge_pair`) **green** (Eng D-018). **A-05 / X-07** owned by P2 suite !27 — do not double-flip here.
| `tests/sim_session.ts` | SIM-01…SIM-09 (**localnet-test only**) — green on tip (!16) |
| `tests/p2_gates.ts` | A-05, R-08, X-07 + INV-P2-I3, INV-PROD-01, INV-FEE-TRUNC |

P0/P1/SIM suites green on `main` (localnet). Cluster H / P2 A-05+X-07 stay **failing** until Engineers pin policy (D-016).

---

## Doc gaps that blocked or softened cases

| Gap | Impact | Interim test stance |
| --- | --- | --- |
| Strike `>=` vs `>` still open in SCHEMA §8 | S-03 locks on **≥** (D-005) | Fail test if Engineers flip without DECISIONS update |
| Admin `outcome_yes` vs price consistency | A-05 → Policy A in Schema !29 | **Covered by P2 suite !27** — do not re-test in Cluster I |
| `Settling` enum unused | X-07 → retire in Schema !29 | **Covered by P2 suite !27** — do not re-test in Cluster I |
| `merge_pair` prod ix (D-018) | Sell No unwind | Cluster I MP-01…MP-08 **green** |
| `burn_losing` optional v1 | R-08 | Skip if ix absent |
| Admin `outcome_yes` vs price consistency | A-05 underspecified | P2; suite pins **reject** until Eng locks reject XOR accept+log |
| `burn_losing` optional v1 | R-08 | Ix on tip; assert supply↓ / no USDC / pairs_redeemed frozen |
| `Void` redeem policy out of v1 | No void cases | Do not invent refund math |
| Exact MAG7 Pyth feed ids not pinned | S-07 uses fixtures | Pin before mainnet eval |
| Zero-amount mint/redeem | M-07 | Prefer reject; confirm in impl |
| Fee rounding (floor/ceil) | M-03, R-05 | Use `amount * bps / 10_000` trunc toward zero per units §3 unless Engineers document otherwise |

---

## Sign-off checklist (Testers, after code lands)

- [ ] All **P0** cases have failing-then-passing Anchor/TS coverage
- [ ] Invariant helpers I1–I5 run on X-04 / X-05
- [ ] Fee=0 path green before enabling fee cases
- [ ] No Meridian test asserts Phoenix matching internals (pubkey + mint wiring only)
- [ ] **SIM-*** cases green on `localnet-test` only; prod `.so` still omits `sim_*` / mock fixtures (D-017)
- [x] **MP-*** (`merge_pair` / D-018) green on prod IDL; pause + post-expiry + fee path covered; no Phoenix matcher invented
- [ ] P2 A-05 / R-08 / X-07 + INV gates green (or X-07 retired)
