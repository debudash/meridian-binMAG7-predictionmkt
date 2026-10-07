# Meridian TDD suite

**Owner:** Meridian Testers  
**Mandate:** D-016 — failing tests first; Engineers implement program paths **only** to green.  
**Anytime sim:** D-017 — localnet simulated open→trade→close→settle→redeem (no wall-clock 9:30/4:00 ET).  
**Case source of truth:** [`docs/TEST_MATRIX.md`](../docs/TEST_MATRIX.md).

## Status

| Layer | Status | Notes |
| --- | --- | --- |
| **P0** | Green on `main` (MR !9) | mint / settle / redeem / $1 vault / pause — 37 case IDs |
| **P1 fees + edges** | Green on `main` (MR !11) | Fees **M-03 / R-05 / V-06** + edges; V-07 via localnet `test_drain_vault` |
| **Sim session (localnet)** | **TDD_RED** (`test/sim-session-lifecycle`) | **SIM-01…SIM-09** — simulated open/close + Phoenix-placeholder trade + MockPyth settle + redeem. Implement **only** to green under `localnet-test`. **Never** required for mainnet builds. |

## Program id / localnet deploy

| | |
| --- | --- |
| **Current** | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` |
| **Revoked** | `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (was committed; treat as compromised) |

Suite constant: `MERIDIAN_PROGRAM_ID` in [`helpers/fixtures.ts`](helpers/fixtures.ts). Harness `assertIdlHasInstructions` checks IDL `address` matches.

**Keypair is not in the tree** (gitignored via `keys/*` + `**/*keypair*.json`). After pulling a rotated `declare_id!` / `Anchor.toml`:

1. Generate (or restore from secret store) `keys/meridian-keypair.json` whose pubkey equals the current id — see [`keys/README.md`](../keys/README.md).
2. Copy to `target/deploy/meridian-keypair.json` for Anchor.
3. Redeploy localnet against the new id (`anchor test` / `yarn test` rebuilds with `--features localnet-test`).

Do **not** commit keypair JSON. Testers own fixture/README alignment only — Engineers own `declare_id!`.

## Layout

| File | Matrix coverage |
| --- | --- |
| `mint.ts` | P0 M-01, M-02, M-04, M-05, M-06, M-08 |
| `settle.ts` | P0 S-01…S-07, S-09, S-11 + A-01…A-04 |
| `unit/pyth_price_to_e6.ts` | P0 S-10 |
| `redeem.ts` | P0 R-01…R-04, R-06, R-07, R-09 |
| `invariants.ts` | P0 V-01…V-05 |
| `pause.ts` | P0 X-01, X-02, X-04, X-05, X-06 |
| `fees.ts` | P1 M-03, R-05, V-06 |
| `p1_edges.ts` | P1 S-08, X-03, M-07, M-09, M-10, V-07, V-08 |
| **`sim_session.ts`** | **SIM-01…SIM-09 (localnet-only / D-017)** |
| `helpers/` | fixtures, I1–I5, Anchor `TestCtx` harness (+ `simOpen` / `simClose` / `simTradeOffBook`) |

## Localnet simulated session (D-017)

- **Sim open / close** are harness-driven fixtures — **not** real 9:30 / 4:00 ET.
- **Sim trade** = mint inventory + **off-book SPL Yes transfer** (Phoenix placeholder / V-08 twin). Meridian does **not** own matching; do not invent a Phoenix matching engine.
- **Settle** uses MockPyth (`upsert_mock_pyth`) or `admin_settle` on localnet only.
- All `sim_*` program ixs **must** stay behind Cargo feature **`localnet-test`** (same deploy gate as `upsert_mock_pyth` / `test_drain_vault`).

## For Engineers (sim session)

1. Branch from latest `main`; keep P0/P1 green.
2. Land `sim_open_session` / `sim_close_session` (names flexible) + `StrikeMarket.trading_open: bool` (default **true** on create so existing suites stay green) under `#[cfg(feature = "localnet-test")]`.
3. Pin errors: mint after close → `TradingClosed` (or `MarketNotOpen`); settle before close → `SessionNotClosed` (SIM-05).
4. Run `yarn test` / `anchor test -- --features localnet-test` until SIM-* green. **Do not** implement Rust in the Testers MR; **do not** weaken prod settle/oracle gates.
5. Prod `anchor build` (no features) must omit `sim_*` symbols.

## Mocks / placeholders

- **Phoenix:** pubkey wiring + off-protocol SPL transfer isolation (V-08 / SIM-02). No Meridian matching CPI.
- **Pyth:** MockPyth / `upsert_mock_pyth` localnet fixture only.

## Run

```bash
yarn install
# Full suite including sim session (requires localnet-test fixtures in the .so):
yarn test
# equivalent:
anchor test -- --features localnet-test

# Prod build check (sim / mock fixture ixs must be ABSENT):
yarn build:prod
```
