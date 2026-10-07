# 03 — Trade Screen (`/markets/[marketId]`)

The core screen. One market = **one Phoenix book**. The user views it from a **Yes** or **No** perspective; the book is the same.

Normative rules: `06-trading-intents-and-constraints.md` (intents §1, constraint §2, countdown §3, payoff §4).

## 1. Purpose & user jobs
1. Understand the question, strike, underlying price, and time to close.
2. Read the market (implied probability, book, recent trades).
3. Place Buy/Sell Yes/No orders with a clear cost and payoff preview.
4. See and manage their position and open orders in this market.
5. After settlement, redeem.

## 2. Layout (desktop ≥1280px, 12-col grid)
```
┌────────────────────────────────────────────────────────────────────────────┐
│ A. Market header: question · underlying · strike · SETTLEMENT COUNTDOWN    │
│    Perspective toggle [ Yes | No ]   Yes 0.62 / No 0.38   24h vol   OI     │
├───────────────────────────────┬──────────────────────┬─────────────────────┤
│ B. Chart (cols 1–6)           │ C. Order book        │ D. Order ticket     │
│   implied price (perspective) │    (cols 7–9)        │    (cols 10–12)     │
│   + underlying Pyth overlay   │    + recent trades   │   intents, size,    │
│                               │    tab               │   price, preview    │
├───────────────────────────────┴──────────────────────┼─────────────────────┤
│ E. Tabs: Position · Open orders · Fills (this market)│ F. Position summary │
│                                                      │   + constraint UX   │
├──────────────────────────────────────────────────────┴─────────────────────┤
│ G. Rules & resolution: payoff copy, Pyth feed, comparator, timestamps     │
└────────────────────────────────────────────────────────────────────────────┘
```
- **Tablet (768–1279):** B full width; C and D side-by-side; E/F stacked.
- **Mobile (<768):** A (compact, countdown pinned under title) → perspective toggle → price + mini chart → sticky bottom bar `[Buy Yes 0.63] [Buy No 0.39]` opening D as a bottom sheet → collapsible C → F → E → G. The ticket sheet keeps the countdown visible in its header.

## 3. Zone A — Header
| Element | Content | Source |
|---|---|---|
| Question | "Will AAPL close at or above $230.00 on Oct 16, 2026?" | `market.question` or composed from `underlyingSymbol`, `comparator`, `strike`, `settleTs` (`TODO(schema)` which is canonical) |
| Underlying | "AAPL $228.14 ±0.03 · Pyth · 12s ago" | Pyth `price`, `conf`, `publishTime` |
| Distance to strike | "−$1.86 (−0.8%) from strike" | derived |
| Countdown | per `06` §3 — primary placement, right side of header, large tabular numerals | `tradingCloseTs`, `settleTs`, `status` |
| Perspective toggle | Segmented `[Yes | No]`; persists in URL `?side=yes|no` and localStorage | client |
| Prices | "Yes 0.62 · No 0.38" both always shown; selected perspective bold | book mid / last |
| Stats | 24h volume (USDC), open interest (contracts), # traders (optional) | indexer |

## 4. Dual perspective on one book
The toggle **changes presentation only**. Subscriptions, market ID, and the underlying data do not change.

| Element | Yes perspective | No perspective |
|---|---|---|
| Bids column | Yes bids `p` | Yes **asks** transformed: `1 − p` |
| Asks column | Yes asks `p` | Yes **bids** transformed: `1 − p` |
| Sort | Asks ascending above spread, bids descending below | same (after transform) |
| Size | contracts | same contracts |
| Mid | `(bestBid + bestAsk)/2` | `1 − midYes` |
| Spread | `bestAsk − bestBid` | identical value |
| Last trade | `p_last` | `1 − p_last`; trade direction color inverted (a Yes buy is shown as a No sell) |
| Depth chart | cumulative depth, Yes prices | mirrored on x-axis |
| Chart | Yes implied price series | `1 − series` |
| Ticket default intents | Buy Yes / Sell Yes | Buy No / Sell No |
| Accent color | Yes token (e.g. teal) | No token (e.g. violet) — **not** red/green, which are reserved for P&L |

Rules:
- Toggling must not reset entered size; price input converts (`p → 1 − p`) with a 1s inline note "Converted to No price".
- Header always shows both prices so users understand they're complementary.
- Helper under the toggle (first visit, dismissible): "Yes and No trade on the same order book. A No price is always 1.00 minus the Yes price."
- Clicking a book row prefills the ticket price. Clicking an **ask** selects the Buy intent of the current perspective; clicking a **bid** selects the Sell intent. If that intent is disabled by `06` §2, keep the current intent and only fill the price.
- Book precision: price = tick (2 decimals default), group levels selector (0.01 / 0.05). Show "Your orders" marker on levels containing user orders (both perspectives, transformed).

## 5. Zone C — Order book & trades
- 12 levels each side (desktop), 6 (mobile). Columns: Price · Size (contracts) · Total (USDC = cumulative `size × price` in current perspective).
- Spread row: "Spread 0.02 · Mid 0.62".
- Trades tab: time, price (perspective), size, aggressor side. Last 50, live.
- Live via Phoenix market account subscription; throttle render to 10 fps; flash changed levels 300ms.
- Stale indicator if no websocket update for 10s and RPC slot advancing: "Book may be stale — reconnecting".
- **Row selection (DLV-071):** clicking a level highlights it (bid/ask-colored tint + left accent bar; `aria-selected`; keyboard focusable, ↑/↓ move between levels) and sets the ticket to Limit at that price (No intents get `1 − p_yes`). The highlight is keyed by price (not row), so it survives book refreshes and the Yes/No toggle; it clears when the level disappears, the user types a different ticket price, switches to Market, or clicks the same row again. A ticket limit price that matches a level highlights it too.

## 6. Zone D — Order ticket
### 6.1 Structure
1. **Intent selector** — 2×2 when space permits, otherwise Buy/Sell tabs + Yes/No (perspective toggle drives Yes/No):
   ```
   [ Buy Yes ] [ Sell Yes ]
   [ Buy No  ] [ Sell No  ]
   ```
   Each button shows its best executable price: Buy Yes = best Yes ask; Sell Yes = best Yes bid; Buy No = `1 − best Yes bid`; Sell No = `1 − best Yes ask`. Disabled states and copy from `06` §2.3 render directly beneath the selector.
2. **Order type** — Market | Limit. **Post only is hidden in V1** (D-021, simplification per Debu): no checkbox; every limit order is sent with post-only = false.
3. **Size** — contracts input with USDC equivalent toggle ("Spend 25 USDC" ↔ "40 contracts"). Quick chips: 25% / 50% / Max. Max for buys = floor(USDC available / worst price); for sells = available-to-sell (held − locked).
4. **Price** (Limit only) — stepper by tick; shows implied %. Warnings: limit crosses the book → "This will fill immediately as a taker". (No post-only rejection warning in V1 — post-only is hidden, D-021.) Clicking an order-book level selects/highlights it and fills this price (switching to Limit); see §5.
5. **Slippage / worst price** (Market only) — default per `06` §1.1; editable in a popover.
6. **Preview block** (per `06` §4):
   | Row | Buy | Sell |
   |---|---|---|
   | Avg price (est.) | VWAP over book | VWAP |
   | Worst price | cap | floor |
   | Cost / Receive | `q × p` | `q × p` |
   | Fees (est.) | Phoenix taker fee + protocol fee (`TODO(schema)`) | same |
   | Payout if {side} | `q × 1.00` | "You give up `q × 1.00` payout" |
   | Max profit / Max loss | shown | — |
   | Position after | "Yes 40 → 80" | "Yes 40 → 0" |
   | Network fee | "~0.000005 SOL + priority" | same |
7. **Primary CTA** — label echoes the full intent: "Buy 40 Yes @ ≤0.63" / "Sell 40 Yes" / "Connect wallet" / "Deposit USDC" / disabled reason.
8. **Footnote** — payoff one-liner + link to Rules (zone G).

### 6.2 Validation (inline, before CTA enables)
| Check | Message |
|---|---|
| size ≤ 0 or not lot multiple | "Enter a size in multiples of 1 contract." |
| insufficient USDC | "Not enough USDC. You have 12.40." + "Deposit" link |
| insufficient position (sell) | "You can sell up to 28 (12 locked in open orders)." |
| price out of range | "Price must be between 0.01 and 0.99." |
| book too thin for market order | "Only 18 contracts available within your worst price." Offer "Fill 18" or "Place limit" |
| constraint (`06` §2) | per §2.3 copy |
| market not open | per countdown state; ticket replaced by state card |
| SOL for fees missing | "You need a small amount of SOL for network fees." |

### 6.3 Confirmation & tx status flow
```
[Review] → [Awaiting signature] → [Submitted] → [Confirmed] → (Filled / Resting / Partially filled)
                │                      │
          user rejects             timeout/expired blockhash / program error
                ▼                      ▼
           [Cancelled]              [Failed]
```
| Step | UI | Copy |
|---|---|---|
| Review (optional, on for first trade / size > `OPEN:` threshold) | Modal with preview table | "Review order" |
| Awaiting signature | CTA spinner, ticket inputs locked | "Confirm in your wallet…" |
| User rejected | Toast neutral | "Order cancelled in wallet." |
| Submitted | Toast with tx sig link (explorer `<EXPLORER_URL>/tx/<sig>`) | "Order submitted…" |
| Confirmed — filled | Toast success; position panel updates | "Bought 40 Yes at avg 0.62 (24.80 USDC)." |
| Confirmed — partially filled (IOC) | Toast warn | "Bought 18 of 40 Yes at avg 0.63. Remaining 22 not filled." |
| Confirmed — resting | Toast info; Open orders tab badge | "Limit order placed: Buy 40 Yes @ 0.60." |
| Failed | Toast error + "Retry" | Map known program errors (`TODO(schema)` error codes): price moved, insufficient funds, market closed, blockhash expired ("Network busy — try again") |
- Commitment: show "Submitted" on send, "Confirmed" at `confirmed`; position math uses confirmed; history waits for indexer. Retry policy: rebroadcast until blockhash expiry (~60–90s), then Failed.
- One in-flight trade tx per market per wallet (locks ticket; see `06` §2.2).

## 7. Zone F — Position panel (this market)
| Field | Example | Source |
|---|---|---|
| Side & size | "**Yes 40**" (or "No position") | outcome balances (wallet + Phoenix free/locked) |
| Avg entry | 0.62 | indexer (fills) — `OPEN:` FIFO vs avg cost |
| Mark | 0.64 (mid, current side) | book |
| Value | 25.60 USDC | `q × mark` |
| Unrealized P&L | +0.80 USDC (+3.2%) | derived |
| Payout if Yes | 40.00 USDC | `q × 1` |
| Locked in orders | 12 (sell) | open orders |
| Actions | "Sell all" (prefills Sell Yes, Max) · "Cancel all orders" | — |

**Constraint UX in panel:**
- When holding Yes: a muted row "Buy No unavailable while you hold Yes" with "Why?" tooltip (`06` §2.3).
- When flat: "No position. You can buy Yes or No."
- When both (legacy, E7/E8): amber banner per `06` §2.3.
- After settlement: panel becomes **Redeem card**: "Settled Yes. Your 40 Yes → 40.00 USDC. [Redeem]" (or "0.00 USDC — nothing to redeem"; offer "Close" to clean accounts if Schema needs it, `TODO(schema)`).

## 8. Zone E — Tabs
- **Open orders:** intent (rendered as Buy/Sell Yes/No, not raw Phoenix side), price (in that intent's terms), size, filled, time, [Cancel]; "Cancel all".
- **Fills:** this market only; links to `05-history`.
- **Position:** same as F on mobile.

## 9. Zone G — Rules & resolution
- Payoff definitions (`06` §4.1 Yes/No strings).
- Resolution: "Resolves using Pyth feed `<PYTH_FEED_ID>` (AAPL/USD) price at 3:00 PM CT Oct 16, 2026. Yes if price ≥ 230.00." Include confidence handling rule (`TODO(schema)`/`OPEN:`).
- Timestamps: trading close, observation, expected resolution.
- Addresses: market `<MARKET_PUBKEY>`, Phoenix market `<PHOENIX_MARKET>`, program `<PROGRAM_ID>` with copy buttons.

## 10. Data needed
| Data | Fields | Source | Freshness |
|---|---|---|---|
| Market metadata | `marketId`, `question`, `underlyingSymbol`, `strike`, `comparator`, `tradingCloseTs`, `settleTs`, `status`, `outcome`, `resolvedPrice`, `pythFeedId`, `phoenixMarket`, `tickSize`, `lotSize`, `min/maxPrice`, `collateralMint` | Meridian program account(s) — `TODO(schema)` | on load + status subscription |
| Book | L2 bids/asks (price ticks, size lots), sequence number | Phoenix market account (ws) | live |
| Trades | price, size, aggressor, ts, sig | Phoenix events / indexer | live |
| Fees | taker bps, maker bps, protocol fee | Phoenix market header + Meridian config `TODO(schema)` | on load |
| Underlying | `price`, `conf`, `expo`, `publishTime` | Pyth (Hermes/pull or on-chain price account) | 1–5s |
| User balances | USDC, SOL, Yes qty, No qty; Phoenix free/locked base & quote | token accounts + Phoenix trader state | live |
| User orders | order id, side, price, size, filled, intent mapping | Phoenix trader state + indexer for intent labels `TODO(schema)` | live |
| User cost basis | avg entry, realized P&L | indexer | on fill |
| Chart | OHLC of Yes price; Pyth history | indexer / Pyth benchmarks | 1m |

## 11. States
| State | Behavior |
|---|---|
| Loading | Skeletons per zone; countdown renders as soon as metadata loads (don't block on book). |
| Disconnected wallet | Full read-only view; ticket shows intents + preview with "Connect wallet" CTA; position panel "Connect a wallet to see your position". |
| Wrong network | Banner (from `07`), CTA "Switch network". |
| Empty book | "No orders yet. Place a limit order to start the book." Market type disabled; Limit default. |
| One-sided book | Disable intents with no liquidity for Market ("No sellers right now — use a limit order"). |
| Book/ws error | Book zone error card + retry; ticket disables Market orders (limit allowed with warning). |
| Pyth stale | Underlying shows timestamp + "stale" chip; trading not blocked (resolution independent). |
| Market not found | 404 per `07`. |
| Closed / resolving / settled | Ticket replaced by state card (countdown state from `06` §3); book shown read-only, greyed. |

## 12. Copy guidelines
- Use the full intent everywhere ("Buy No"), never "short" or "bid/ask" in primary UI (book column headers may say "Bid/Ask" with tooltip).
- Always pair price with side: "No 0.38", not "0.38".
- Numbers in tabular figures; USDC 2 decimals; contracts integer.

## 13. Acceptance criteria
- [ ] Yes/No toggle changes no subscriptions; book, mid, last, spread, depth, chart, ticket default intents transform exactly per §4 (unit tests with integer ticks).
- [ ] Both Yes and No prices visible in header in either perspective; `Yes + No mid = 1.00`.
- [ ] Four intents present, each mapped per `06` §1; CTA label states intent, size, and price.
- [ ] Buy No disabled with §2.3 copy + "Sell N Yes" CTA when `yesExposure > 0` (and mirror); Sell held side always enabled when available > 0.
- [ ] Open Buy orders and pending txs count toward exposure.
- [ ] `?side=` and `?intent=` deep links validated through `getIntentAvailability`.
- [ ] Preview shows cost/proceeds, fees separately, payout if win, max profit/loss, position after.
- [ ] Countdown in header in all states of `06` §3; ticket replaced at close; trading disabled ≥5s before `tradingCloseTs` (chain-time based).
- [ ] Tx flow shows signature → submitted → confirmed with partial-fill and resting outcomes, and maps rejected/failed.
- [ ] Settled market shows Redeem card with correct payout.
- [ ] Disconnected wallet: fully readable, no errors, CTA = Connect wallet.
- [ ] Mobile: sticky Buy Yes/Buy No bar, ticket bottom sheet with countdown.
