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
| [08-price-display.md](08-price-display.md) | **Price display (normative for 01/02/03)**: Buy Yes / Buy No buttons and pills show executable top-of-book prices; mid only as a labeled `NN% implied Yes`; one-sided/empty fallbacks (`Spread —`); settled cards show no prices |
| [wireframes/](wireframes/) | **SPEC freeze wireframes** (MR !20) — Landing/Markets/Trade/Portfolio/History |

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
- Prices displayed in USDC with 2 decimals (`0.62`), optionally as implied % (`62%`). Which price goes where (executable vs labeled implied mid): `08`. Sizes in whole contracts unless `market.lotSize` says otherwise.

## Selection & active states (standing rule — D-022, DLV-073)

**Anything clicked or selected must be clearly highlighted or identifiable, everywhere in the UI.** One shared treatment, defined once in `apps/web/src/app/globals.css` (tokens `--sel-color`, `--sel-tint`, `--sel-ring-width`, `--focus-ring`):

| State | Treatment |
|---|---|
| **Selected / active** | Border in `--sel-color` + tinted background (`--sel-tint`, ~18%) + 2px accent ring, bolder label. Chips / segmented toggles also show a ✓ (non-colour cue). Rows get the tint plus a 3px left accent bar. |
| **Colour by context** | Default accent. `.sel-yes` / `.sel-no` for Yes/No choices (header perspective toggle, ticket intents), `--bid` / `--ask` for order-book rows. |
| **Unselected** | Solid 1px border, no tint (Yes/No intent buttons: faint tint + 45% coloured border). Hover = lighter border / subtle tint. |
| **Disabled** | Dashed border, greyscale, muted text, no tint or ring, `not-allowed` cursor — must never read as "unselected" or "selected" (e.g. Sell Yes / Sell No with no position). Disabled links also leave the tab order. |
| **Keyboard focus** | Separate `:focus-visible` ring (`--focus-ring`, light blue, 2px offset) on every interactive element; never removed for keyboard users. |
| **Last viewed** | The market last opened (sessionStorage) is marked "Last viewed" on cards and in the table/ladder (`aria-current="true"`). |

**ARIA drives the visuals** (CSS selects on ARIA state, so semantics and looks can't drift):
- `aria-pressed` — toggles and single-choice button groups: filter chips, view toggle (Cards/Table/Ladder), header Yes/No, ticket intents, Market/Limit.
- `aria-selected` — tabs (`role=tablist`/`tab`, ←/→/Home/End roving focus) and selectable rows (order book `role=listbox`/`option`; tables `role=grid` rows, click or Enter/Space toggles).
- `aria-current="page"` — primary nav (desktop + mobile bottom nav, brand link on `/`); `aria-current="true"` for the current item in a list (last-viewed market, selected portfolio card — cards hold links/buttons so they can't be `option`s).

Applies to: nav; market filters, view toggle, cards (hover lift / pressed / visited title / last viewed); trade header Yes/No, order-book rows (DLV-071), ticket intents + Market/Limit, Position/Open orders/Fills tabs and their rows; portfolio tabs, position/redeem cards, open-order rows; history type tabs and rows; wallet button (open state), dropdown and modal list items. New controls must reuse these classes/ARIA states rather than inline styles. Logic helpers: `lib/ui/selection.ts` (tested), wiring: `components/ui/a11y.ts`.
