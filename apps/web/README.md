# Meridian Web (`apps/web`)

Next.js (App Router) + TypeScript UI for Peak6 Meridian binary Yes/No markets.

**Specs:** `docs/ui/*` · **On-chain client:** `idl/meridian.prod.json` only (never localnet IDL / fixtures).

## Stack

- Solana wallet adapter + versioned transactions
- Anchor program client for `mint` / `redeem` / read settle status
- Phoenix CLOB as Yes/USDC book (D-015) — `@ellipsis-labs/phoenix-sdk` place/cancel when market configured
- Intent composition: Buy/Sell Yes = bid/ask; **Buy No** = Meridian mint + ask Yes @ `1−p_no`; **Sell No** = bid Yes @ `1−p_no` then **`merge_pair`** (same tx when market/immediate; resting = bid only, merge-on-fill phased)
- Indexer: `listMarkets` / `getMarket` via `NEXT_PUBLIC_INDEXER_URL` or RPC `StrikeMarket` GPA; fixtures when live data empty
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


## Phoenix

SDK: **`@ellipsis-labs/phoenix-sdk`** (V1 spot). Placement is gated:

| Condition | Behavior |
| --- | --- |
| `NEXT_PUBLIC_PHOENIX_ENABLED=false` or no `phoenixMarket` pubkey | Structured **not-configured** (`ok:false`) — TradeTicket CTA does **not** say “Confirm in your wallet…” |
| Market pubkey set (+ optional `ENABLED=true`) + wallet | Build/sign/submit place (limit / IOC market / post-only); seat/ATA setup ixs prepended when needed |
| **Buy No** | Prefer multi-ix tx: Meridian `mint` then Phoenix ask Yes @ `1−p_no` (needs vault/mints/treasury on `MarketView`) |
| **Sell No** | Phoenix bid Yes only; **merge awaits Schema** (no `merge` in `meridian.prod.json`) |

Seat claim helper: `buildClaimSeatInstructions` / README steps — claim via `getMakerSetupInstructionsForMarket` when placing.

Composition unit tests: `src/lib/phoenix/compose.test.ts` (no live RPC).

## Indexer

`src/lib/indexer` — `listMarkets`, `getMarket`, optional `listFills` / `getPortfolioHints`. Prefer HTTP indexer URL, else RPC GPA on Meridian `StrikeMarket`, else fixtures + banner.

## Railway

Web service build/start: `next build` / `next start` from this package.
Env vars: see [`.env.example`](./.env.example) and [`.env.railway.staging.example`](./.env.railway.staging.example) — [`docs/DEPLOY.md`](../../docs/DEPLOY.md) §4 · [`docs/RAILWAY_STAGING.md`](../../docs/RAILWAY_STAGING.md).

**Hard rule:** do not import `localnet-test` helpers, mock Pyth, `sim_*`, or `test_drain_vault` into this package. Clients load **`meridian.prod.json`** only.

## Program id

Default: `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` (overridable via `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID`).

## Railway

- Service **rootDirectory**: `apps/web`
- Config: [`railway.json`](./railway.json) — `next build` / `next start`, Node ≥20, `healthcheckPath=/api/health`
- Health route: [`src/app/api/health/route.ts`](./src/app/api/health/route.ts)

