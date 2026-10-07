# Sim lifecycle — localnet one-command (D-017)

**Audience:** Meridian Engineers / Testers  
**Gate:** `SOLANA_CLUSTER=localnet` only. **Never** run on Railway / devnet / mainnet.

Documented one-command/scripted sim path alongside calendar automation (`apps/automation`).

## Command

```bash
# Repo root (after apps/automation build)
yarn automation:sim

# Or
npm run sim-lifecycle --prefix apps/automation
```

Entrypoint: `apps/automation/src/sim-lifecycle.ts` → `dist/sim-lifecycle.js`.

## Required env

See `apps/automation/.env.example` (sim section):

| Var | Value |
| --- | --- |
| `MODE` | `sim` |
| `SOLANA_CLUSTER` | `localnet` |
| `SOLANA_RPC_URL` | `http://127.0.0.1:8899` (or validator URL) |
| `MERIDIAN_IDL_PATH` | `idl/meridian.json` (full localnet IDL — **not** prod) |
| `AUTOMATION_KEYPAIR` | JSON path / byte array (authority) |
| `COLLATERAL_MINT` | localnet USDC/test mint |
| `STRIKE_SYMBOLS` | e.g. `AAPL` |

Optional: `PHOENIX_MARKETS`, `ADMIN_SETTLE_*` for fallback after settle failure.

**Forbidden on Railway:** `ANCHOR_FEATURES=localnet-test`, `MODE=sim`, fixture IDL.

## Lifecycle steps

1. `upsert_mock_pyth` — seed a mock price account (localnet-test ix)
2. `create_strike_market` — one strike from config placeholders
3. `set_phoenix_market` — if `PHOENIX_MARKETS` provides a pubkey (Phoenix **create** still TODO)
4. `sim_open_session` — sets `trading_open` (as landed on main via eng/sim-session)
5. **Mint + on-book trade (documented):** call `mint(amount)` while session open; prefer harness **`simTradeOnBook`** (Buy/Sell Yes/No compose + book-sim fill + Sell No `merge_pair`) — [`phoenix-onbook-sim.md`](phoenix-onbook-sim.md). Off-book Yes SPL is demoted fallback. Phoenix **market create** on validator still residual; client SDK place when `phoenixMarket` set (D-015)
6. `sim_close_session` — closes trading session
7. `settle` (real decoder path against mock feed on localnet) or `admin_settle` after delay if configured

## Isolation from calendar / Railway

| Entry | Imports sim module? | IDL |
| --- | --- | --- |
| `dist/worker.js` | **No** | `meridian.prod.json` |
| `dist/sim-lifecycle.js` | **Yes** | `meridian.json` |

Calendar mode keeps the real **≥16:00 America/New_York** settle gate + Pyth quality. Sim must not weaken those prod invariants.

## Related

- `docs/DEPLOY.md` §4 automation service
- `docs/flows.md` §1 daily lifecycle · §8 SimClock (future) / session sim on main
- `docs/sim-clock.md` · `tests/sim_session.ts` (SIM-01…09)
- Decision **D-017**
