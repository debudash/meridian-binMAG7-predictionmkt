# Meridian TDD suite (failing / red)

**Owner:** Meridian Testers  
**Mandate:** D-016 — failing tests first for vault $1, mint, settle, redeem, pause.  
**Case source of truth:** [`docs/TEST_MATRIX.md`](../docs/TEST_MATRIX.md) (lands via MR !5 if not yet on `main`).

## Status

These tests are intentionally **RED** until Engineers land Anchor program code under `programs/meridian/` that satisfies SCHEMA instructions (`mint`, `settle`, `admin_settle`, `redeem`, `pause`, …).

Do **not** implement product logic in this suite. Green the cases by shipping program instructions only.

## Layout

| File | Matrix coverage (P0) |
| --- | --- |
| `mint.ts` | M-01, M-02, M-04, M-05, M-06, M-08 |
| `settle.ts` | S-01…S-07, S-09, S-11 + A-01…A-04 |
| `unit/pyth_price_to_e6.ts` | S-10 (units.md §8) |
| `redeem.ts` | R-01, R-02, R-03, R-04, R-06, R-07, R-09 |
| `invariants.ts` | V-01…V-05 |
| `pause.ts` | X-01, X-02, X-04, X-05, X-06 |
| `helpers/` | fixtures, I1–I5 asserts, TDD harness |

## Mocks / placeholders (do not invent a matching engine)

- **Phoenix:** store/assert `phoenix_market` + base=Yes / quote=USDC only (D-004, D-015). No place/cancel/fill CPI in Meridian tests.
- **Pyth:** placeholder price-account + feed-id bytes; settle gates per D-005. Conversion vectors in `unit/pyth_price_to_e6.ts`.

## How Engineers go green

1. Scaffold `programs/meridian` per [`programs/meridian/README.md`](../programs/meridian/README.md).
2. Implement SCHEMA §5 instructions; regenerate IDL into `target/idl/meridian.json`.
3. Replace `helpers/harness.ts` `requireProgram` with a real Anchor `Program` client + bankrun/local validator fixtures.
4. Run `yarn test` / `anchor test` until P0 cases pass. Keep case IDs in `it()` titles.

## Run (once deps + program exist)

```bash
yarn install
yarn test          # full suite
yarn test:unit     # S-10 only
yarn test:lifecycle
```

Without program sources, integration cases throw `TDD_RED` (expected).
