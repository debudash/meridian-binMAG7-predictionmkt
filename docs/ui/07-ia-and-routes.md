# 07 — IA, Routes, Navigation & Global States

## Information architecture
```
Meridian
├── Landing            /
├── Markets            /markets
│   └── Trade          /markets/[marketId]
├── Portfolio          /portfolio        (wallet required for data)
├── History            /history          (wallet required for data)
└── Static             /rules  /terms  /risk   (OPEN: hosted in-app vs <DOCS_URL>)
```

## Next.js routes (App Router)
| Route | File | Rendering | Query params |
|---|---|---|---|
| `/` | `app/page.tsx` | SSR shell + client islands (featured card) | — |
| `/markets` | `app/markets/page.tsx` | SSR initial list from indexer, client refresh | `status`, `u` (underlyings csv), `expiry`, `sort`, `view=cards|table|ladder`, `q` |
| `/markets/[marketId]` | `app/markets/[marketId]/page.tsx` | SSR metadata (`generateMetadata` for title/OG); client book/ticket | `side=yes|no`, `intent=buy-yes|sell-yes|buy-no|sell-no`, `price`, `size` |
| `/portfolio` | `app/portfolio/page.tsx` | Client (wallet) | `tab=positions|orders|redeemable` |
| `/history` | `app/history/page.tsx` | Client (wallet) | `type`, `market`, `from`, `to`, `side`, `page` |
| 404 | `app/not-found.tsx` | static | — |
| Error | `app/error.tsx`, per-segment `error.tsx` | client | — |
| Loading | per-segment `loading.tsx` | — | — |

- `marketId` = market public key (base58) `TODO(schema)` or a human slug (e.g. `aapl-230-2026-10-16`) resolved by indexer. `OPEN:` slug vs pubkey; recommend pubkey canonical + slug alias redirect.
- Deep-link params are **hints**: always validated (`06` §2.5). Invalid `intent` → fallback to allowed intent + visible reason.

## Providers (root layout)
`ConnectionProvider(<RPC_URL>)` → `WalletProvider` (wallet-standard autodetect) → `QueryClientProvider` (indexer/RPC caching) → `ChainClockProvider` (slot/time skew for countdowns) → `TxStatusProvider` (global toast queue, `03` §6.3) → `PythProvider`.

Config via env: `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_PHOENIX_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_CLUSTER` — values are placeholders until Schema/deploy provides them.

## Global navigation
Header (all routes): Logo → `/` · Markets · Portfolio · History · [cluster badge: devnet/mainnet] · [Wallet button].
- Wallet button connected: truncated address, USDC balance; menu: Copy address, View on explorer, Disconnect.
- Portfolio nav shows a dot when redeemables > 0.
- Mobile: bottom tab bar (Markets, Portfolio, History) + header with wallet.
- Global toast stack bottom-right (desktop), top (mobile).

## Global states
| State | Detection | UI |
|---|---|---|
| Disconnected | no wallet | Read-only everywhere; wallet-only pages show connect prompt card. Never auto-open wallet modal on load. |
| Connecting | adapter state | Wallet button spinner |
| Wrong cluster | wallet/RPC genesis hash ≠ expected | Top banner "You're connected to devnet. Meridian runs on <CLUSTER>." Trading CTAs disabled. |
| No USDC token account | ATA missing | Ticket CTA "Deposit USDC"; ATA creation bundled into first tx if needed (`TODO(schema)` who pays rent) |
| No SOL | lamports < fee threshold | Inline "You need SOL for network fees." |
| RPC degraded | slot lag / errors > threshold | Banner "Network connection degraded — data may be delayed." |
| Indexer down | health check fail | Per-section degraded messages (see screens); trading still works from RPC. |
| Pyth stale | publishTime age > threshold | Per-price "stale" chip with timestamp |
| Program paused | `TODO(schema)` global pause flag | Banner "Trading is paused." All trade CTAs disabled; redeem per program rule. |
| Geo/compliance gate | `OPEN:` PM/legal | Placeholder interstitial before trading |
| 404 market | indexer/program returns none | "Market not found." + "Browse markets" |
| Unhandled error | error boundary | "Something went wrong." + Retry + copy error id |

## Cross-screen consistency rules
- Countdown component `<SettlementCountdown market />` is one shared component (`06` §3).
- Intent availability via one hook `useIntentAvailability(marketId)` (`06` §2.5) used by Trade, Markets cards, Portfolio.
- Price formatting via `formatOutcomePrice(ticks, side)`; payoff strings via a single copy module (`06` §4.1) for i18n readiness.
- Side colors: Yes/No accent tokens; red/green reserved for P&L and settled-result.

## Acceptance criteria
- [ ] All routes in table exist with loading/error/not-found handling.
- [ ] Every page usable read-only without a wallet; wallet pages show connect prompt.
- [ ] Wrong-cluster and program-paused banners block trading CTAs globally.
- [ ] Deep-link params validated and reflected in URL state.
- [ ] Shared countdown, intent-availability, and formatting modules used everywhere (no per-screen reimplementation).
