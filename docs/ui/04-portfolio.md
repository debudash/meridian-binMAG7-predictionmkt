# 04 — Portfolio (`/portfolio`)

## Purpose & user jobs
- See all open positions, their value, P&L, and time to settlement.
- Redeem settled winning positions.
- Manage open orders across markets.
- See available USDC/SOL and Phoenix unsettled funds.

## Layout
Desktop:
1. **Summary bar**: Portfolio value (positions at mark + USDC) · USDC available · Unrealized P&L · Redeemable now (with "Redeem all" if > 0) · Unsettled Phoenix funds (with "Settle" if applicable, `TODO(schema)`).
2. **Tabs**: Positions (default) · Open orders · Redeemable · (link) History.
3. **Positions table**.

Mobile: summary as 2×2 tiles; positions as cards; actions in row overflow menu.

## Positions table
| Column | Content |
|---|---|
| Market | "AAPL ≥ $230.00 · Oct 16" → Trade |
| Side | **Yes** / **No** chip (side accent colors) — one row per market (per `06` §2 there is normally one side) |
| Size | 40 (and "12 locked" sub-line if in sell orders) |
| Avg entry | 0.62 |
| Mark | 0.64 |
| Value | 25.60 USDC |
| Unrealized P&L | +0.80 (+3.2%) |
| Payout if right | 40.00 USDC |
| Settlement | countdown per `06` §3 |
| Actions | "Trade" (→ `/markets/[id]?side=<held>&intent=sell-<held>`) · "Sell all" (opens ticket drawer) |

Legacy "both sides" (`06` §2.4 E7/E8): render one row with two side lines and amber "Both sides held" chip; actions limited to Sell Yes / Sell No.

Sort default: settlement soonest. Group toggle: by underlying.

## Redeemable tab
Rows: market, outcome ("Settled Yes"), your side, size, payout ("40.00 USDC" or "0.00"), [Redeem]. "Redeem all" batches into as few txs as fit (`TODO(schema)` redeem instruction + per-tx limit). Losing positions: show with "Close" (rent reclaim) if Schema requires; otherwise hide under "Show expired (0 payout)".

## Open orders tab
Market · Intent (Buy/Sell Yes/No, derived — `TODO(schema)` how to label Buy No orders, see `06` §1) · Price (intent terms) · Size · Filled · Placed · [Cancel]; "Cancel all". Markets past close show orders as "Expired — cancel to release funds" if applicable.

## Data needed
| Data | Source |
|---|---|
| Outcome balances per market (Yes, No; wallet + Phoenix free/locked) | token accounts + Phoenix trader state; indexer for discovery of markets the wallet touched |
| Cost basis, realized P&L | indexer (fills) — `OPEN:` average cost method |
| Mark prices | Phoenix top of book (mid), fallback last |
| Market status/outcome/close times | Meridian program / indexer |
| Open orders | Phoenix trader state per market |
| USDC, SOL balances | token account, system account |

## Actions
Primary: Redeem / Redeem all; Sell all (ticket drawer reusing Trade ticket component, intent locked to Sell held side). Secondary: Cancel order(s), Trade link, Settle funds.

All tx actions follow the tx status flow in `03` §6.3.

## States
| State | Behavior |
|---|---|
| Disconnected | "Connect a wallet to see your positions." + Connect button; no data fetch. |
| Loading | Summary + table skeleton |
| Empty | "No open positions." + "Browse markets" |
| Only redeemables | Positions empty copy + Redeemable tab badge auto-selected |
| Indexer down | Show positions from on-chain balances; P&L columns "—" with tooltip "Cost basis unavailable" |
| Error | per-section retry |

## Copy
"Payout if right", "Redeem 40.00 USDC", "Settled: Yes". Avoid "winnings". P&L signed with +/− and color; never color side chips red/green. *(Superseded by D-028: side chips are green Yes / red No; P&L always carries its +/− sign so it stays readable next to side colour.)*

## Acceptance criteria
- [ ] One row per market; side chip reflects held side; legacy both-sides handled.
- [ ] Countdown per row; settled rows move to Redeemable.
- [ ] Redeem single + batch with tx flow and updated balances.
- [ ] Sell all uses shared ticket and respects locked quantities.
- [ ] Works without indexer for balances (degraded P&L).
- [ ] Disconnected/empty/error states implemented.
