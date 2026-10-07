# Meridian TDD suite

**Owner:** Meridian Testers  
**Mandate:** D-016 — failing tests first; Engineers implement program paths **only** to green.  
**Case source of truth:** [`docs/TEST_MATRIX.md`](../docs/TEST_MATRIX.md).

## Status

| Layer | Status | Notes |
| --- | --- | --- |
| **P0** | Green on `eng/p0-anchor-impl` (MR !9) | mint / settle / redeem / $1 vault / pause — 37 case IDs |
| **P1 fees + edges** | **TDD contract** (`test/p1-fees-failing`) | Fees **M-03 / R-05 / V-06** + invited edges below. Implement only to green. Do **not** weaken P0 fee=0 asserts. |

`eng/p0-anchor-impl` already ships mint/redeem fee math (fee-on-transfer-in, default **0 bps** per D-006). This P1 suite is the formal gate for **non-zero** bps + related edges. **V-07** stays `TDD_RED` until a controlled vault-drain fixture exists.

## Layout

| File | Matrix coverage |
| --- | --- |
| `mint.ts` | P0 M-01, M-02, M-04, M-05, M-06, M-08 |
| `settle.ts` | P0 S-01…S-07, S-09, S-11 + A-01…A-04 |
| `unit/pyth_price_to_e6.ts` | P0 S-10 |
| `redeem.ts` | P0 R-01…R-04, R-06, R-07, R-09 |
| `invariants.ts` | P0 V-01…V-05 |
| `pause.ts` | P0 X-01, X-02, X-04, X-05, X-06 |
| **`fees.ts`** | **P1 M-03, R-05, V-06** |
| **`p1_edges.ts`** | **P1 S-08, X-03, M-07, M-09, M-10, V-07, V-08** |
| `helpers/` | fixtures, I1–I5, Anchor `TestCtx` harness |

## For Engineers (P1)

1. Rebase onto latest `eng/p0-anchor-impl` after MR !9 merges (or merge !9 first).
2. Run `anchor test` — green all P0; then green P1 fees/edges.
3. **Implement only what is still red.** Do not change P0 fee=0 equalities.
4. Keep case IDs in `it()` titles. Prefer fee-on-transfer-in so vault == outstanding liability (SCHEMA §7.3).
5. **V-07:** either land a safe drain fixture that proves `InsufficientVault`, or document impossibility and ask Testers to retire the case.

## Mocks / placeholders

- **Phoenix:** pubkey wiring + off-protocol SPL transfer isolation (V-08). No Meridian matching CPI.
- **Pyth:** MockPyth / `upsert_mock_pyth` localnet fixture only.

## Run

```bash
yarn install
anchor test
# or
yarn test:lifecycle
```
