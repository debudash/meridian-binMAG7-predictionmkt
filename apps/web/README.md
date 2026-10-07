# Meridian Web (`apps/web`)

Next.js (App Router) + TypeScript UI for Peak6 Meridian binary Yes/No markets.

**Specs:** `docs/ui/*` · **On-chain client:** `idl/meridian.prod.json` only (never localnet IDL / fixtures).

## Stack

- Solana wallet adapter + versioned transactions
- Anchor program client for `mint` / `redeem` / read settle status
- Phoenix CLOB as Yes/USDC book (D-015) — book UI shell + intent mapping; order placement stubbed (`TODO(phoenix)`)
- Pyth for display / settlement status (provider shell; feeds via env)

## Routes

| Path | Screen |
| --- | --- |
| `/` | Landing |
| `/markets` | Markets discovery |
| `/markets/[marketId]` | Trade |
| `/portfolio` | Positions + redeem |
| `/history` | Activity history |
| `/rules` | Payoff / resolution stub |

## Local run

```bash
# from repo root
npm install --prefix apps/web
cp apps/web/.env.example apps/web/.env.local
# edit NEXT_PUBLIC_* as needed
npm run web:dev
# or: npm run dev --prefix apps/web
```

Open http://localhost:3000.

## Tests / checks

```bash
npm run test --prefix apps/web        # vitest (intent matrix)
npm run typecheck --prefix apps/web
npm run lint --prefix apps/web
npm run build --prefix apps/web
```

## Railway

Web service build/start: `next build` / `next start` from this package.
Env vars: `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT` — see [`docs/DEPLOY.md`](../../docs/DEPLOY.md) §4.

**Hard rule:** do not import `localnet-test` helpers, mock Pyth, `sim_*`, or `test_drain_vault` into this package. Clients load **`meridian.prod.json`** only.

## Program id

Default: `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (overridable via `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID`).
