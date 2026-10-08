# 02 — Markets List / Discovery (`/markets`)

## Purpose & user jobs
- Find a market by ticker, expiry, or strike.
- Compare implied prices across strikes/expiries for one underlying.
- See which markets close soon and which recently settled.

## Layout
Desktop:
1. Page title "Markets" + search (ticker or question text).
2. **Filter bar**: Status [Open (default) · Closing soon · Closed · Settled], Underlying (multi-select), Expiry (date chips), Sort [Closing soonest · Volume 24h · Open interest · Newest].
3. **View toggle**: Cards (default) | Table | **Ladder** (grouped by underlying+expiry, rows = strikes).
4. Results; infinite scroll or pagination (50/page).

Mobile: search + filter sheet; card view only; ladder as accordion per underlying.

## Components
### Market card
| Element | Content |
|---|---|
| Ticker chip | AAPL |
| Question | "AAPL ≥ $230.00 at close Oct 16" |
| Prices | "Yes 0.62 · No 0.38" (mid; fallback last; "—" if empty book) |
| Implied | "62% implied Yes" |
| Underlying | "AAPL $225.00 · needs +2.2%" / "is 0.8% above strike" (DLV-075; mock Pyth on localnet, "—" if no feed) |
| Countdown | per `06` §3 compact ("2d 4h", "42:18", "Closed", "Settled: Yes") |
| Stats | 24h vol, OI |
| Your position badge (connected) | "You: Yes 40" / "You: No 25" |
| Actions | [Buy Yes] [Buy No] (respecting `06` §2: if user holds Yes, Buy No shows disabled with tooltip "You hold Yes") → Trade deep link |

**One book rule:** each market appears **once**; Yes and No are shown as two prices in the same card/row, never as separate list entries.

### Table columns
Underlying · Question · Yes bid/ask · No bid/ask (derived) · Last · 24h vol · OI · Closes (countdown) · Status · Your position.

### Ladder view (one underlying + expiry)
| Strike | Yes bid | Yes ask | No bid | No ask | Implied | Vol |
Highlight row nearest current underlying price. Implied should be monotone decreasing in strike for "≥" markets; show no warning UI for non-monotonic (data, not error).

## Data needed
| Data | Source |
|---|---|
| Market list with `marketId`, `underlyingSymbol`, `strike`, `comparator`, `tradingCloseTs`, `settleTs`, `status`, `outcome`, top-of-book Yes bid/ask, last, 24h vol, OI, `createdAt` | indexer (paged, filterable). `TODO(schema)`: confirm indexer exposes market registry, or UI must `getProgramAccounts` on `<PROGRAM_ID>` |
| Underlying prices | Pyth (batched per symbol) |
| User positions per market | indexer or token balances (connected only) |

Top-of-book refresh: poll indexer 5s or subscribe to visible markets' Phoenix accounts (cap 20 subs). `OPEN:` indexer ws availability.

## Actions
- Primary: open market (card click → `/markets/[marketId]`), Buy Yes / Buy No deep links.
- Secondary: filter, sort, search, view toggle, favorite (`OPEN:` v1?).
- Filters/sort serialized to URL query (`?status=open&u=AAPL,TSLA&sort=close`).

## States
| State | Copy / behavior |
|---|---|
| Loading | 8 skeleton cards |
| Empty (no markets at all) | "No markets yet." |
| Empty (filters) | "No markets match these filters." + "Clear filters" |
| Error | "Couldn't load markets. Retry." (keep filters) |
| Disconnected | Normal; position badges hidden |
| Stale data | Chip "Prices delayed" if last update > 30s |

## Copy
Short question form on cards ("AAPL ≥ $230.00 at close Oct 16"); full question on Trade. Times show absolute on hover.

## Acceptance criteria
- [ ] Each market appears exactly once; Yes and No prices shown together; `No = 1 − Yes` derived.
- [ ] Default filter Open, sort Closing soonest; URL reflects state and is shareable.
- [ ] Countdown on every card/row consistent with `06` §3.
- [ ] Ladder groups strikes per underlying/expiry and highlights nearest strike.
- [x] Buy buttons respect the Yes+No constraint for connected users (DLV-074): cards, table and ladder share `useMarketTradeState` → `getIntentAvailability` (same rules as the ticket) fed by **one batched** `getMultipleParsedAccounts` over the listed markets' Yes/No ATAs (`useWalletPositions`, chunked at 100, 10s poll, paused when the tab is hidden). Blocked side uses the D-022 disabled style + short title ("You hold Yes — sell it first"). Resting buy orders are not read yet (DLV-068) — same as the ticket.
- [ ] Empty/error/loading states implemented.
