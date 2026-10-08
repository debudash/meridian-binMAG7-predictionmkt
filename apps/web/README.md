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

### Localnet dev wallet (localnet only)

To sign on a local `solana-test-validator` without Phantom/Solflare, enable the
**Localnet Dev Wallet** adapter in `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SOLANA_CLUSTER=localnet
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_LOCALNET_DEV_WALLET=true
# server-only: path to a *localnet* keypair JSON (outside the repo; never commit it)
LOCALNET_DEV_WALLET_KEYPAIR=/path/to/localnet-dev-wallet.json
```

Then pick **Localnet Dev Wallet** under *Select Wallet*. The adapter is only
registered — and `/api/localnet-dev-wallet` only answers (else 404) — when **all** hold:
`next dev` (never in a `next build` / `next start` production bundle), cluster `localnet`,
flag `true`, RPC URL on loopback, request `Host` on loopback, forwarded client address on
loopback, `LOCALNET_DEV_WALLET_KEYPAIR` set, **and the dev server itself bound to loopback**.
It is never shown on devnet/mainnet or any production build. Fund the key on localnet yourself
(airdrop + fixture USDC mint).

> Start it with `npm run dev` (= `next dev -H 127.0.0.1`). Host / `x-forwarded-for` are
> client-controlled, so the route also probes its own port on every external interface; if the
> server answers there (`next dev -H 0.0.0.0` or no `-H`) it returns 404 and logs
> `[dev-wallet] refused: … reachable off-loopback` (DLV-081). Restart bound to 127.0.0.1 to fix.

#### Fresh (flat) dev wallet without reseeding (DLV-113)

VISUAL_RUNBOOK §5 starts flat. If the current dev key already holds positions, swap in a new key
instead of reseeding the validator (markets, books and the maker are untouched):

1. Back up `apps/web/.env.local` (mode 600, outside the repo).
2. `solana-keygen new --no-bip39-passphrase --silent -o <new-key>.json` outside the repo, `chmod 600`.
   Only ever print its **pubkey**.
3. Fund it on localnet: `requestAirdrop` 20 SOL (faucet), then create its fixture-USDC ATA and
   `mintTo` 100,000 USDC signed by the localnet USDC mint authority (the localnet admin key).
4. Change only `LOCALNET_DEV_WALLET_KEYPAIR=<new-key>.json` in `.env.local`, restart `npm run dev -- -p 3000`
   (loopback), then in the browser **Disconnect** and pick **Localnet Dev Wallet** again.
5. Check `/api/localnet-dev-wallet` derives the new pubkey (don't print the key).

The previous dev key keeps its balances and Phoenix seats, so the operator can use it as the
**second localnet key** that crosses your resting order in VISUAL_RUNBOOK §9.2.
Undo: restore the `.env.local` backup and restart.

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
| **Sell No** | Market = Phoenix bid Yes @ `1−p_no` + Meridian `merge_pair` (same tx); resting = bid only, merge-on-fill phased (`SELL_NO_MERGE_CAVEAT`) |

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

