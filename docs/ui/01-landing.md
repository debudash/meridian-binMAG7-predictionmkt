# 01 — Landing (`/`)

## Purpose & user jobs
- Explain in one screen what Meridian is: binary Yes/No markets on stock prices, 1.00 USDC payout per winning contract.
- Get users to a live market fast.
- Returning users: jump to Portfolio or markets closing soon.

## Layout
Desktop:
1. **Header** (shared, `07`): logo, Markets, Portfolio, History, network badge, Connect wallet.
2. **Hero** (left 7 cols): headline + subhead + CTAs. Right 5 cols: one **live featured market card** (real data, not a mockup).
3. **How it works** (3 steps, horizontal).
4. **Closing soon** strip: 4–6 market cards sorted by `tradingCloseTs`.
5. **Rules strip**: payoff, resolution via Pyth, fees, one-side-per-market note.
6. **Footer**: docs link `<DOCS_URL>`, terms `<TERMS_URL>`, risk disclosure, program `<PROGRAM_ID>`. *(As built: Rules · Terms · Risk · Status links and the deployed program id, shortened and linked to Solana Explorer; see `07`.)*

Mobile: single column; featured card under hero; closing-soon as horizontal scroll.

## Components & content
| Component | Content |
|---|---|
| Headline | "Trade yes/no outcomes on stock prices." |
| Subhead | "Each contract pays 1.00 USDC if it's right at settlement. Prices reflect the market's implied odds. On Solana, priced by Pyth." |
| CTAs | Primary "Browse markets" → `/markets`; secondary "How it works" (anchor). Connected users with positions: secondary becomes "View portfolio". |
| Featured market card | Question, underlying price (Pyth), `62% implied Yes` label, countdown (`06` §3), [Buy Yes 0.63] [Buy No 0.39] (executable prices, card rules in `08`) → `/markets/[id]?intent=buy-yes|buy-no` |
| How it works | 1 "Pick a market — e.g. 'Will AAPL close ≥ $230 on Oct 16?'" 2 "Buy Yes or No — pay the price, e.g. 0.62 USDC per contract." 3 "At settlement — winning contracts pay 1.00 USDC; losing pay 0." |
| Rules strip | "One order book per market — No price = 1.00 − Yes price." · "Resolved by Pyth price at a stated time." · "Hold one side per market in this app." |
| Risk note | "You can lose the full amount you pay for a contract." |

Featured market selection: `OPEN:` PM-curated list vs highest 24h volume (default: highest volume among Open markets).

## Data needed
| Data | Source |
|---|---|
| Featured + closing-soon markets: `marketId`, `question`, `underlyingSymbol`, `strike`, `tradingCloseTs`, `status`, Yes best bid/ask, last, 24h vol | indexer `<INDEXER_URL>` (list) + Phoenix (featured live book top) |
| Underlying price/publishTime | Pyth |
| Has positions (connected) | indexer / balances (for CTA swap) |

## Actions
- Primary: Browse markets; Buy Yes / Buy No on featured card (deep link, validated on Trade).
- Secondary: How it works, Connect wallet, View portfolio.

## States
| State | Behavior |
|---|---|
| Loading | Hero static (SSR); cards skeleton. |
| No open markets | Featured card replaced: "No markets are open right now. Next market opens Oct 9, 8:30 AM CT." (if known) or "Check back soon." + link to settled markets. |
| Indexer error | Hide strips, keep hero + CTA; small inline "Live markets unavailable." |
| Disconnected | Default; no wallet prompt on load. |

## Copy guidelines
Plain, numeric, no hype ("win big", "moon", emoji prohibited). Always show "1.00 USDC" payout with the word "if".

## Acceptance criteria
- [ ] Hero renders via SSR without wallet or RPC.
- [ ] Featured card shows live executable Buy Yes / Buy No prices (Buy Yes = best Yes ask, Buy No = 1 − best Yes bid) plus a labeled `NN% implied Yes` mid, per `08` (no unlabeled mid; Buy Yes + Buy No = 1.00 + spread), and a live countdown.
- [ ] Featured Buy buttons deep-link with `intent` and land on Trade with constraint validation.
- [ ] Payoff and risk copy present above the fold or in rules strip.
- [ ] Empty/error states as tabled; LCP < 2.5s on 4G.
