# Meridian automation (Node/TS)

Railway-ready dual-mode automation for Peak6 Meridian (**D-017**).

| Mode | Entry | Cluster | IDL |
| --- | --- | --- | --- |
| **calendar** (default) | `node dist/worker.js` | devnet / mainnet-beta | `idl/meridian.prod.json` only |
| **sim** (localnet only) | `node dist/sim-lifecycle.js` | `localnet` | `idl/meridian.json` (full / fixtures) |

## Dual-mode isolation

- `src/worker.ts` imports **only** `modes/calendar.ts` — never `modes/sim.ts`.
- `src/sim-lifecycle.ts` is the sole importer of `modes/sim.ts` (mock Pyth + `sim_open_session` / `sim_close_session`).
- `solana/client.ts` **refuses** fixture IDL instruction names when `SOLANA_CLUSTER` is not `localnet`.
- Never set `ANCHOR_FEATURES=localnet-test` on Railway (`docs/DEPLOY.md` §2).

## Quick start

```bash
cd apps/automation
cp .env.example .env   # fill secrets via env — never commit
npm install
npm run build
npm start              # calendar worker
```

### Sim one-liner (localnet validator + deployed localnet-test program)

```bash
# from repo root
yarn automation:sim
# or
npm run sim-lifecycle --prefix apps/automation
```

Requires `SOLANA_CLUSTER=localnet`, `MODE=sim`, `AUTOMATION_KEYPAIR`, `COLLATERAL_MINT`, and a running local validator with the Meridian program built with `--features localnet-test`.

Lifecycle: **create → sim_open → (mint documented) → sim_close → settle / admin_settle**.

See [`docs/DEPLOY.md`](../../docs/DEPLOY.md) §3.3.

## Railway

- **Build:** `npm install && npm run build:railway` ([`railway.json`](./railway.json))
- **Start:** `node dist/worker.js`
- Env table: `docs/DEPLOY.md` §5.2 + `.env.example`
- Program id default: `3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj`

## Operator copilot (D-029 / D-030, read-only)

The worker runs two checks per trading day inside its own tick (no cron): **create at 08:30 ET** (30 min after the 08:00 deadline) and **settle at 16:30 ET** (30 min after the close). Each logs a `[copilot]` report (lines with `ALERT` when something needs attention) and is kept in memory (last 20) for `GET /copilot` on the health port, which the web `/status` page reads over Railway private networking (`AUTOMATION_STATUS_URL`). The pass starts in the background and is never awaited, so it can't hold up create / pause / settle. The page always shows the latest session whose 08:30 check time has passed (before 08:30, or on a weekend, that is the previous session); after a restart its checks rerun once. If the 16:30 settle check needs attention, it re-checks once at 17:30 ET.

1. **Facts** (`src/copilot/facts.ts`, plain code): every expected symbol has its markets for the day (`STRIKE_OFFSETS_E6` strikes each; the staging Railway service sets `STRIKE_OFFSETS_E6=0`, so 1), each with an order book; after the close, every one is settled, with its close price and outcome. Anything wrong is an issue.
2. **Message** (`src/copilot/summarize.ts`): code writes the ✅/⚠️ mark, every issue, the runbook pointer and every market line. **No API key is needed.** With `ANTHROPIC_API_KEY` set, Claude (`COPILOT_MODEL`, default `claude-opus-5-5`, low effort) also writes the headline sentence; `verifyHeadline` rejects it (code headline used) for a number outside the counts / issues / schedule, a percentage, a spelled-out number, wrong YES/NO counts, all-clear wording while there are issues, or more than 300 characters.
3. **Where it shows**: the worker log and the web Status page. Nothing is sent anywhere else.

`src/copilot/runner.ts` schedules and stores; `src/copilot-cli.ts` (`--checkpoint create|settle [--date] [--per-symbol N] [--no-ai] [--json]`) runs one check by hand. No keypairs, no transactions. Tests: `test/copilot.test.ts` (the real 2026-10-09 day as fixture; Claude stubbed).

## Tests

```bash
npm test
```

Covers the market-day calendar, D-026 create window, strikes, operator prices, pull settle, settler / pauser keys, pause monitoring, the operator copilot and prod-entry ↔ sim-module isolation. Latest counts: [`docs/TEST_RESULTS.md`](../../docs/TEST_RESULTS.md) §1.

## Notes / stubs

- Phoenix **market create** is TODO (SDK-heavy); when `PHOENIX_MARKETS` provides a pubkey, automation calls `set_phoenix_market`.
- **Same-day 0DTE (DLV-118, SPEC §1/§3.3; timing D-026):** calendar mode creates each trading day's markets from
  `CREATE_FROM_ET` (**07:00 ET**) and must be done by `CREATE_DEADLINE_ET` (**08:00 ET**; else `ALERT create deadline …
  missed` once a day, retries continue until 16:00) with `expiry_ts` = **that day's 16:00 America/New_York close** (`src/marketDay.ts`; DST via Intl; weekends + NYSE holidays
  2026–2028 skipped; unknown year refuses, ALERT 30 days ahead). **NYSE early-close days (13:00 ET) are refused with an
  ALERT** (DLV-119 M-1; 13:00 handling is a mainnet Todo). After the close it never creates (no next-day roll). Idempotent
  per ET day: an open-market scan failure aborts the tick (L-1); a failed create is an ALERT and the day stays open, the
  retry creates only the missing strikes of the day's first plan (L-3). `PHOENIX_MARKETS` is ignored for daily markets (L-8).
- **Strike reference = the previous trading day's close (D-026; 13:00 ET after an early close):** Hermes price at that
  close (`/v2/updates/price/{close}`, publish_time ≤ `PRIOR_CLOSE_MAX_SKEW_SECS` (300) after it; needs an entitled
  `PYTH_HERMES_API_KEY`, staging key entitled since 2026-10-09, DLV-106) → sponsored `PYTH_PRICE_FEEDS` account if Pyth-receiver-owned,
  Full-verified and posted in that same window → **operator prior closes** (`OPERATOR_STRIKE_PRICES(_FILE)`, JSON
  `{dateKey: <market day>, closeDateKey: <previous trading day> (required), source, pricesE6}`) → else skip + `ALERT` and retry next tick.
  ATM = reference rounded to `STRIKE_STEP_E6` (default $5 ≥ $100, else $1) + `STRIKE_OFFSETS_E6`. No hardcoded prior close.
- **Settle at the close:** permissionless pull settle first; when Hermes has no usable price, `admin_settle` after the on-chain delay at
  the **operator close price** (`OPERATOR_CLOSE_PRICES(_FILE)`, bound to the market's ET day + symbol, source required;
  outcome = price ≥ strike). The static `ADMIN_SETTLE_PRICE_E6` is localnet-only, and `SOLANA_CLUSTER=localnet` refuses to
  start on a non-loopback RPC (L-5). Staging operator prices: `node ops/operator-prices.cjs` (see [`docs/DEPLOY.md`](../../docs/DEPLOY.md) §6.2).
- `node dist/ops-cli.js market-day [--now <unix>] [--strikes]` prints today's session / plan (used by `ops/run-staging.sh`).
- Localnet: `scripts/localnet/today-markets.cjs` creates today's-close MAG7 markets with books (SimClock-aware, additive).

## Railway

- Deployed with `railway up` from `git archive <sha>:apps/automation`, so this package is the upload root ([`docs/DEPLOY.md`](../../docs/DEPLOY.md) §5.1)
- Config: [`railway.json`](./railway.json) — start `node dist/worker.js`, `healthcheckPath=/health`
- IDL: committed/synced [`idl/meridian.prod.json`](./idl/meridian.prod.json) (from `yarn build:prod-idl` at repo root). Default `MERIDIAN_IDL_PATH=idl/meridian.prod.json`.
- Build: `npm run build:railway` (excludes `sim-lifecycle` / `modes/sim` from `dist/`)
- Health: worker listens on `HEALTH_PORT`/`PORT` (default 8080) at `/health`

