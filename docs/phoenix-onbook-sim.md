# Phoenix on-book sim E2E (DLV-064)

**Goal:** Replace the **off-book Yes SPL placeholder** sim trade with an **on-book** path for Buy/Sell Yes and Buy/Sell No under localnet — without inventing a Meridian matching engine (ARCHITECTURE / D-015).

## What runs today (maximum viable)

| Layer | Path | Notes |
| --- | --- | --- |
| Client (apps/web) | `@ellipsis-labs/phoenix-sdk` place + Buy No mint + Sell No `merge_pair` | Landed !28 / !33 — needs a real `phoenixMarket` pubkey |
| Localnet harness | **`simTradeOnBook`** (`tests/helpers/phoenix_onbook.ts`) | Compose → optional mint → **book-sim fill** (Yes↔USDC @ planned price) → optional `merge_pair` |
| Mocha suite | `tests/phoenix_onbook_e2e.ts` (PHX-01…06) | Green under `anchor test -- --features localnet-test` |
| Off-book | `simTradeOffBook` | **Demoted** non-prod fallback / V-08 twin only |

Book-sim fill models Phoenix match **economics** (taker ↔ counterparty) and **never** touches Meridian vault/`pairs_*` (SCHEMA §7.7). Meridian still only mints / merges / settles.

### Commands

```bash
# Full localnet suite (includes PHX-* + SIM-*)
yarn test
# or: anchor test -- --features localnet-test

# Focused PHX cases only (still needs Anchor validator lifecycle)
yarn test:phoenix-onbook

# Compose unit twin (no validator)
yarn test:unit   # includes tests/unit/phoenix_compose.ts when present
```

Env:

| Var | Default | Meaning |
| --- | --- | --- |
| `PHOENIX_ONBOOK_MODE` | `book-sim` | Preferred localnet path |
| | `off-book-fallback` | Refuse `simTradeOnBook` — call `simTradeOffBook` explicitly |
| | `phoenix` | Reserved: requires live Phoenix market on validator (throws with pointer here) |

## Demo script mapping

See [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) step 5: prefer `simTradeOnBook` / client Phoenix place; off-book is non-prod fallback only.

Automation sim (`yarn automation:sim`) logs the on-book path; it does not create a Phoenix market (create still residual).

## Residual — full Phoenix CLOB on solana-test-validator

**Not shipped in DLV-064:**

1. Dump/load `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` + seat manager into the Anchor test validator.
2. `InitializeMarket` for a Yes/USDC book with Meridian Yes mint + fixture USDC (SDK exposes place/cancel — **not** a TS create-market helper).
3. Claim seat + real place/fill against that book inside `anchor test`.

**Why blocked (honest):** Phoenix V1 market creation is program-ix + large account setup outside `@ellipsis-labs/phoenix-sdk` instruction surface used by Meridian; seat manager / log authority accounts add more deploy surface. Shipping a fake Meridian CPI matcher is forbidden.

**Unblock later:** phoenix-cli / Ellipsis local scripts to create a market on localnet, then set `StrikeMarket.phoenix_market` and flip `PHOENIX_ONBOOK_MODE=phoenix` once harness place/fill is wired.

Until then, **book-sim + client SDK packing** is the accepted on-book sim E2E for Peak6 demo / D-017 anytime sim.

## Related

- Client: `apps/web/src/lib/phoenix/{compose,client,size}.ts`
- Flows: [`flows.md`](flows.md) §2–3 (Buy No / Sell No beside Phoenix)
- Tracker: DLV-064
