# 05 — History (`/history`)

## Purpose & user jobs
- Review past fills, settlements, and redemptions.
- Reconcile P&L per market; export for records.
- Find tx signatures for support.

## Layout
1. Filters: Type [All · Fills · Settlements · Redemptions · Cancels], Market/underlying search, Date range, Side [Yes/No].
2. Table (paged, 50 rows, newest first).
3. Export CSV button (current filters).
4. Per-market realized P&L summary drawer (click market name).

Mobile: list cards with type icon; filters in sheet; export hidden in overflow.

## Table
| Column | Fill | Settlement | Redemption |
|---|---|---|---|
| Time | local, abbreviated tz | resolvedAt | ts |
| Type | "Fill" (maker/taker tag) | "Settled" | "Redeemed" |
| Market | short question → Trade | same | same |
| Intent / Outcome | "Buy Yes" | "Result: Yes" | "Yes" |
| Price | 0.62 (intent terms) | resolved underlying price vs strike "231.42 ≥ 230.00" | 1.00 / 0.00 |
| Size | 40 | your held size at settlement | 40 |
| Amount | −24.80 USDC | — | +40.00 USDC |
| Fee | 0.05 USDC | — | — |
| Realized P&L | for closing fills | — | vs cost basis |
| Tx | short sig + copy + explorer `<EXPLORER_URL>/tx/<sig>` | resolution tx | tx |

Intent label derivation for fills: indexer must classify Phoenix fills (Yes base) + Meridian mint/merge wrapper into Buy/Sell Yes/No. `TODO(schema)`: event/log fields to make this deterministic (e.g. an intent tag in wrapper instruction logs).

## Data needed
| Data | Source |
|---|---|
| Fills: `sig`, `slot`, `ts`, `marketId`, `intent`, `price`, `size`, `fee`, `makerOrTaker`, `orderId` | indexer |
| Settlements: `marketId`, `outcome`, `resolvedPrice`, `resolvedAt`, `resolutionSig`, user's size at settle | indexer + Meridian program |
| Redemptions: `sig`, `ts`, `marketId`, `size`, `amount` | indexer |
| Cancels: `sig`, `orderId`, `ts` | indexer |

## Actions
Primary: filter, open market, copy sig. Secondary: export CSV (columns as table, ISO-8601 UTC times + local column).

## States
| State | Behavior |
|---|---|
| Disconnected | "Connect a wallet to see your history." |
| Loading | Row skeletons |
| Empty | "No activity yet." + "Browse markets" |
| Filtered empty | "No activity matches these filters." + Clear |
| Indexer lag | Banner "Recent activity may take up to a minute to appear." when a tx confirmed < 60s ago isn't indexed yet; show it optimistically from local tx cache, tagged "Pending index". |
| Error | "Couldn't load history. Retry." |

## Acceptance criteria
- [ ] Fills render as one of four intents, never raw bid/ask.
- [ ] Settlements show outcome, resolved Pyth price vs strike, and user's size.
- [ ] Every row links to its tx signature.
- [ ] CSV export matches filtered view.
- [ ] Optimistic pending rows reconcile with indexer without duplicates (dedupe by sig).
