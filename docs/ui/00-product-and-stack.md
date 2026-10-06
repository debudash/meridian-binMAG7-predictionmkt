# 00 — Product & Stack

## Product
**Meridian** (Peak6 / Gauntlet) lists **binary stock outcome markets** on Solana. Each market asks one yes/no question about a stock price at a fixed time, e.g.:

> "Will AAPL close at or above $230.00 on Oct 16, 2026?"

- Users trade **Yes** or **No** contracts.
- At settlement, the winning side pays **1 collateral unit** per contract; the losing side pays **0**.
- Prices trade between `0.01` and `0.99` (exact bounds/tick from market config — `TODO(schema)`), so price ≈ market-implied probability.

### Payoff assumptions (state these in UI help copy)
| # | Assumption | Status |
|---|---|---|
| A1 | Collateral is USDC (`<USDC_MINT>`), 6 decimals. | Assumed; `TODO(schema)` confirm |
| A2 | 1 contract is fully collateralized: 1 Yes + 1 No = 1 USDC. | Assumed |
| A3 | Winning contract redeems for exactly 1.00 USDC; losing for 0.00. | Assumed |
| A4 | `No price = 1.00 − Yes price` for display purposes (one book). | Design rule |
| A5 | Fees (Phoenix taker/maker + any protocol fee) are shown separately, never folded into "payoff". | Design rule |
| A6 | Resolution source is a Pyth price feed sampled per market rule (time + comparator + strike). | `TODO(schema)` exact rule/fields |

## Hard product rules (cross-reference)
1. **One book per market.** Yes and No are two *perspectives* on the same Phoenix market. The UI never lists them as two markets. → `03-trade.md`, `06-…`
2. **Four explicit intents:** Buy Yes, Sell Yes, Buy No, Sell No. → `06-…` §1
3. **No simultaneous Yes+No from the trading UI.** Holding Yes blocks Buy No and vice versa; selling the held side is always allowed. → `06-…` §2
4. **Settlement countdown** visible on every market surface. → `06-…` §3
5. **Payoff copy** standardized. → `06-…` §4

## Stack
| Layer | Choice | UI implications |
|---|---|---|
| Chain | Solana | Wallet adapter (Phantom, Solflare, Backpack…); tx lifecycle = sign → submitted → confirmed/finalized; priority fees; blockhash expiry. |
| Order book | Phoenix CLOB | Book = L2 bids/asks on one market; base = outcome contract (Yes, see below), quote = USDC. Limit, IOC ("market"), post-only. Seat/claim & settle-funds flows may be required. |
| Oracle | Pyth | Underlying stock reference price + confidence + publish time; used for display and resolution. Equity feeds have market-hours gaps — UI must show staleness. |
| Frontend | Next.js (App Router), TypeScript | Server components for static market metadata; client components for wallet, book subscriptions, ticket. |
| Data | RPC websockets + indexer (`<INDEXER_URL>`) | Live book/fills via Phoenix account subscriptions; history/portfolio aggregates from indexer. |

### Book convention (UI assumption — `TODO(schema)` confirm)
The Phoenix market's **base asset is the Yes contract** and quote is USDC. All raw book data is in Yes terms. The No perspective is a **pure transform** (`p_no = 1 − p_yes`, bids↔asks swapped). See `03-trade.md` §4.

## Boundaries with Schema workstream
- Schema owns on-chain accounts, instruction names, and PDAs. UI docs reference **named data fields** (e.g. `market.strike`, `market.settleTs`) — these are *requirements*, not layouts.
- Every such field is listed in the "Data needed" table of each screen; ambiguities are tagged `TODO(schema):`.
- No program IDs, mints, or URLs are invented: use `<PROGRAM_ID>`, `<PHOENIX_PROGRAM_ID>`, `<USDC_MINT>`, `<PYTH_FEED_ID>`, `<INDEXER_URL>`, `<RPC_URL>`.

## Tone
Clear, precise, markets-trading. No hype, no "win big", no emoji. Numbers over adjectives. Always show units (USDC, contracts, %).
