# Meridian UI Design Specs

Engineer-ready UI specifications for **Meridian** — binary stock outcome markets (Peak6 / Gauntlet) on Solana.

Repo of record: https://labs.gauntletai.com/debudash/peak6-meridian (files live at `docs/ui/` in this repo).

## Stack summary
- **Chain:** Solana (wallet adapter, versioned txs)
- **Order book:** Phoenix CLOB — **one book per market**; Yes and No are two perspectives on it
- **Oracle:** Pyth (underlying stock price; resolution source)
- **Frontend:** Next.js (App Router) + TypeScript
- **Collateral:** USDC-style (`<USDC_MINT>`); winning contract pays 1.00 USDC (assumption, see `00`)

## Index
| File | Contents |
|---|---|
| [00-product-and-stack.md](00-product-and-stack.md) | Product framing, payoff assumptions, stack constraints, Schema boundary |
| [01-landing.md](01-landing.md) | Landing page |
| [02-markets.md](02-markets.md) | Markets list / discovery |
| [03-trade.md](03-trade.md) | **Trade screen** — Yes/No perspectives on one book, ticket, position panel, tx flow |
| [04-portfolio.md](04-portfolio.md) | Open positions, redeemables, open orders |
| [05-history.md](05-history.md) | Past fills, settlements, redemptions |
| [06-trading-intents-and-constraints.md](06-trading-intents-and-constraints.md) | **Cross-cutting rules**: intents→order mapping, no Yes+No constraint, countdown states, payoff copy |
| [07-ia-and-routes.md](07-ia-and-routes.md) | IA, Next.js routes, nav, global empty/error/wallet states |

## How screens relate
```
/ (Landing) ──► /markets (Discovery) ──► /markets/[marketId] (Trade)
                      ▲                         │  ▲
                      │                         ▼  │
                      └──── /portfolio ◄────────┘  │  (position rows deep-link to Trade
                                 │                 │   with held side preselected)
                                 ▼                 │
                            /history ──────────────┘  (fill rows link to market)
```
- `06` is normative for **every** screen that shows prices, positions, countdowns, or payoff text. Screen specs reference it rather than restating rules.
- `07` defines shared shells (header, wallet button, network banner) and global states used by all screens.

## Conventions
- `TODO(schema):` — needs a field/instruction decision from the Schema workstream.
- `OPEN:` — product/PM decision needed.
- Placeholders: `<PROGRAM_ID>`, `<PHOENIX_PROGRAM_ID>`, `<USDC_MINT>`, `<PYTH_FEED_ID>`, `<INDEXER_URL>`, `<RPC_URL>`.
- Prices displayed in USDC with 2 decimals (`0.62`), optionally as implied % (`62%`). Sizes in whole contracts unless `market.lotSize` says otherwise.
