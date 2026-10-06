# Meridian AI decision log

Append-only log of agent decisions for Peak6 Meridian. Newest entries at the top.

---

## 2026-10-06 — Schema slice defaults (Meridian Schema)

**Agent:** Meridian Schema  
**Repo path:** `docs/SCHEMA.md` (+ companions)  
**Status:** Proposed on branch `schema/docs-slice` (land via MR)

### Locked defaults
| Decision | Choice | Rationale |
| --- | --- | --- |
| Price / strike / settlement / Yes price scale | `PRICE_SCALE = 1_000_000` (1e6) | Align with USDC + outcome mint decimals (6) |
| Phoenix base mint | Yes outcome mint | Single Yes/USDC book; UI maps No via inverse |
| Phoenix quote mint | Collateral (USDC) | Standard CLOB quote |
| Custom matching | **Do not build** — integrate Phoenix only | Stack lock |
| Pyth max staleness | 150 slots | Settle gate |
| Pyth max confidence ratio | 500 bps (5%) | Reject noisy prints |
| Yes wins if | `settlement_price_e6 >= strike_price_e6` | Inclusive touch |
| Binary payout | $1 USDC per winning token | Vault covers outstanding pairs |
| Protocol fees | Fields present; default **0 bps** | Can enable later without layout change |
| Pause behavior | Blocks mint/create; settle+redeem still allowed | Protect LPs / resolution |
| Forge | Gauntlet Labs GitLab only (`labs.gauntletai.com/debudash/peak6-meridian`) | No GitHub/Origin |

### Accounts / instructions / events (summary)
- Accounts: `Config`, `StrikeMarket`, vault authority PDA, Yes mint, No mint
- Instructions: create market, mint, settle, admin_settle, redeem, pause, set_phoenix_market
- Events: MarketCreated, Minted, Settled, Redeemed (+ config/pause updates as needed)

### Open questions (see SCHEMA.md §8)
1. Phoenix base side (Yes vs No) — default Yes pending PM/UI confirm
2. Exact MAG7 Pyth feed ids / price accounts
3. `>=` vs `>` on strike
4. `equity_symbol` `[u8;8]` vs AssetRegistry PDA
5. StrikeMarket PDA seeds `(symbol, expiry, strike)` vs `market_id` only
6. Whether v1 includes `burn_losing`
7. Fee policy beyond 0 bps defaults
8. Settle-window policy vs automation retries
9. Multi-collateral — out of scope for v1

### Non-goals this slice
- No Anchor program source yet (scaffold map only under `programs/meridian/`)
- No custom CLOB
- No frontend work (parallel track)
