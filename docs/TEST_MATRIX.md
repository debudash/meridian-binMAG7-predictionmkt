# Meridian Test Matrix — Mint / Settle / Redeem + $1 Vault

**Status:** plan only (draft). **Execution waits until Engineers land program code** on `main`.  
**Audience:** Meridian Testers → Anchor/TS integration tests later.  
**Stack:** Solana + Anchor; Phoenix CLOB (integrate, no matching in Meridian); Pyth equity closes; USDC collateral; MAG7 binary Yes/No.

**Source of truth (docs on `main`):**
- [`SCHEMA.md`](SCHEMA.md) §§5–7 (instructions, events, invariants)
- [`flows.md`](flows.md) §§2–5, §7 (mint / settle / redeem / pause)
- [`accounts.md`](accounts.md) (status machine, writers, vault PDA)
- [`units.md`](units.md) (fee math, Pyth→e6, payout identity, test vectors)
- [`DECISIONS.md`](DECISIONS.md) D-003…D-006, D-015
- [`../programs/meridian/README.md`](../programs/meridian/README.md) (scaffold test plan + errors)

**TDD note:** When program scaffolding exists, translate **P0** rows into failing Anchor/TS tests first; do not implement product logic in the same change as this matrix.

---

## How to read columns

| Column | Meaning |
| --- | --- |
| Case ID | Stable id (`M-##` mint, `S-##` settle, `A-##` admin settle, `R-##` redeem, `V-##` vault/invariant, `X-##` cross-phase / pause) |
| Phase | `mint` / `settle` / `admin_settle` / `redeem` / `invariant` / `pause` |
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
| Phoenix | Store pubkey + assert base=Yes / quote=USDC when set; **no** place/fill assertions inside Meridian tests |

**Invariant helpers (assert after every happy path and after redeem batches):**

```text
I1  Binary $1: redeem(amount) with fee=0 → collateral_out == amount
I2  Supply (status==Open): yes_mint.supply == no_mint.supply == pairs_minted  (absent unpaired burns)
I3  Vault: collateral_vault.amount >= (pairs_minted - pairs_redeemed)
    Prefer equality when fees skim to treasury at mint/redeem (fee-on-transfer-in)
I4  Settlement immutability: SettledYes|SettledNo|Void → settle/admin_settle must fail; fields frozen
I5  Pause: blocks mint + create_strike_market; settle + redeem still succeed
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
| A-05 | admin_settle | Authority sets `outcome_yes` inconsistent with `price_e6` vs strike | `admin_settle` | **Doc gap:** SCHEMA allows explicit `outcome_yes` arg — record actual impl policy; test whatever is locked | Emergency path | P2 | draft |

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
| R-08 | redeem | Optional `burn_losing(amount)` after settle | burn loser | Supply of loser ↓; **no** USDC; `pairs_redeemed` unchanged | P2 if ix ships v1 | P2 | draft |
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
| X-07 | lifecycle | `Settling` status if implemented | treat like Open for reads; settle completes | Pin behavior if Engineers add intermediate state | accounts.md status table | P2 | draft |

---

## Priority rollup (plan coverage)

| Phase | P0 | P1 | P2 | Total |
| --- | ---: | ---: | ---: | ---: |
| mint | 6 | 4 | 0 | 10 |
| settle | 9 | 1 | 0 | 10 |
| admin_settle | 4 | 0 | 1 | 5 |
| redeem | 7 | 1 | 1 | 9 |
| invariant | 5 | 3 | 0 | 8 |
| pause / lifecycle | 6 | 1 | 1 | 8 |
| **Sum** | **37** | **10** | **3** | **50** |

*(S-10 counted under settle P0 as unit-testable without full program.)*

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

Until Engineers land program code: **no** Anchor test execution; keep Status = `draft` / `pending code`.

---

## Doc gaps that blocked or softened cases

| Gap | Impact | Interim test stance |
| --- | --- | --- |
| Strike `>=` vs `>` still open in SCHEMA §8 | S-03 locks on **≥** (D-005) | Fail test if Engineers flip without DECISIONS update |
| Admin `outcome_yes` vs price consistency | A-05 underspecified | P2; assert emitted fields match args |
| `burn_losing` optional v1 | R-08 | Skip if ix absent |
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
