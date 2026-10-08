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
| `SETTLER_KEYPAIR` | optional — JSON path / byte array for the settle signer (M3); unset → authority |
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

## Today's-close MAG7 markets on a dev validator (DLV-118)

SPEC §1/§3.3: 0DTE markets expire at **today's 16:00 America/New_York close**. Additive, idempotent, localnet only:

```bash
cd apps/automation && npm run build          # provides dist/marketDay.js (the shared expiry rule)
RPC=http://127.0.0.1:8899 MERIDIAN_IDL=<localnet-test target/idl/meridian.json> \
  node scripts/localnet/today-markets.cjs      # DRY_RUN=1 = plan only
```

- All 7 MAG7 (SYMBOLS to narrow), one ATM strike each from the localnet mock reference (REF_PRICES to override), a mock
  Pyth feed, a Phoenix V1 book under the Seat Manager and a 5-level maker ladder.
- Effective clock = SimClock (if the PDA exists and is enabled) else chain time — **read only**. D-017 anytime testing: set /
  warp the SimClock into a session first on a validator where that's allowed; the script never touches it.
- At/after that day's close it **refuses** (exit 3) — never rolls to tomorrow. Weekends/holidays refuse unless
  `ALLOW_NON_TRADING_DAY=1`. Existing markets are never edited (only new PDAs + the Config `next_market_id`).

## Related

- `docs/DEPLOY.md` §4 automation service
- `docs/flows.md` §1 daily lifecycle · §8 SimClock (future) / session sim on main
- `docs/sim-clock.md` · `tests/sim_session.ts` (SIM-01…09)
- Decision **D-017**
