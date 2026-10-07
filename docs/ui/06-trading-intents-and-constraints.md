# 06 — Trading Intents & Constraints (normative, cross-cutting)

This doc is the **source of truth** for intents, the Yes+No position constraint, settlement countdown states, and payoff copy. Screens (`03`, `04`, `02`, `01`) must follow it.

Notation: `p` = price in Yes terms on the Phoenix book (USDC per Yes contract). `q` = quantity in contracts. `yesQty`, `noQty` = user's held contracts for this market (wallet balance + Phoenix free/locked balances — see §2.4).

---

## 1. Intents → order semantics

The user always picks **an intent**, never a raw Phoenix side. The UI translates.

| Intent | User meaning | Book action (Yes-base book) | Price user sees | Cost / proceeds (pre-fee) | Requires |
|---|---|---|---|---|---|
| **Buy Yes** | Open/increase Yes | **Bid** Yes at `p` | `p` | Pays `q × p` USDC | USDC; `noQty == 0` |
| **Sell Yes** | Reduce/close Yes | **Ask** Yes at `p` | `p` | Receives `q × p` USDC | `q ≤ yesQty − yesLockedInAsks` |
| **Buy No** | Open/increase No | Economically = **Ask** Yes at `1 − p_no`. Mechanism: mint pair (1 USDC → 1 Yes + 1 No) and sell the Yes, atomically. | `p_no = 1 − p` | Pays `q × p_no` USDC (= `q × 1` minted − `q × p` from Yes sale) | USDC; `yesQty == 0` |
| **Sell No** | Reduce/close No | Economically = **Bid** Yes at `1 − p_no`, then merge Yes+No → 1 USDC, atomically. | `p_no = 1 − p` | Receives `q × p_no` USDC | `q ≤ noQty − noLockedInOrders` |

- **LOCKED (D-018 / Schema):** Meridian does **not** wrap Phoenix in one program ix. Client composes:
  - **Buy No:** `mint` + Phoenix **ask** Yes @ `1 − p_no` (shipped Eng !28). Immediate fill → same tx; resting limit → ask only (funded by minted Yes); on fill, user keeps No (Yes sold).
  - **Sell No:** Phoenix **bid** Yes @ `1 − p_no`, then prod ix **`merge_pair`** (burn Yes+No → USDC). Immediate fill → bid + `merge_pair` in same tx; resting limit → **bid only**; on (partial) fill, client calls `merge_pair(filled)` (may be a follow-up tx). Display resting Sell No as the open Yes bid (tagged No intent).
- **Resting representation:** Buy No open order = Phoenix Yes ask (mint already done or mint-in-same-tx for new size); Sell No open order = Phoenix Yes bid. Partial fill updates `noQty` when merge completes (Sell No) or when Yes ask fills (Buy No — No already held from mint). UI must label these as open No orders (intent tag), distinct from raw Buy/Sell Yes.
- Any transient Yes+No co-holding inside an atomic mint/`merge_pair` (+ Phoenix) tx is **not** a violation of §2 (the user never ends a successful intent tx holding both).

### 1.1 Order types
| Type | Phoenix mapping | Ticket label | Default |
|---|---|---|---|
| Market | IOC with limit = worst acceptable price (slippage cap) | "Market" | Yes |
| Limit | Limit (GTC) | "Limit" | — |
| ~~Post-only~~ | Limit post-only | **Hidden in V1** (D-021, simplification per Debu) — no checkbox; always sent as post-only = false | off (forced) |

- Market orders always carry a **max price** (buy) / **min price** (sell) derived from slippage setting (default 2¢, `OPEN:` default value). Shown as "Worst price".
- Prices snap to `market.tickSize`; sizes snap to `market.lotSize` (`TODO(schema)`).
- Clamp prices to `[market.minPrice, market.maxPrice]` (expected 0.01–0.99).

### 1.2 Price conversion rules (No perspective)
- `p_no_bid = 1 − p_yes_ask`, `p_no_ask = 1 − p_yes_bid`.
- No-perspective bids = Yes asks transformed; No-perspective asks = Yes bids transformed. Sizes unchanged.
- Round **after** conversion using integer tick math (ticks, not floats) to avoid 0.6199999 artefacts. Store prices as integer ticks / base units in state; format only at render.

---

## 2. Position constraint: no simultaneous Yes + No from the trading UI

### 2.1 Rule
The trading UI **must not** let a user open or increase a position that would leave them holding Yes and No in the same market simultaneously.

| User holds | Buy Yes | Sell Yes | Buy No | Sell No |
|---|---|---|---|---|
| Flat (0/0) | ✅ | ⛔ (nothing to sell) | ✅ | ⛔ (nothing to sell) |
| Yes > 0 | ✅ | ✅ | ⛔ **blocked** | ⛔ (nothing to sell) |
| No > 0 | ⛔ **blocked** | ⛔ (nothing to sell) | ✅ | ✅ |
| Both > 0 (legacy/external) | ⛔ | ✅ | ⛔ | ✅ |

"Nothing to sell" = disabled, not shown as an error. "Blocked" = disabled with explanatory copy (§2.3).

### 2.2 Pending exposure counts
Treat as "holding" for the constraint:
- Settled balances (wallet tokens + Phoenix free balances of the outcome).
- **Resting buy orders** on a side (open Buy Yes limit → blocks Buy No; open Buy No limit → blocks Buy Yes).
- In-flight (submitted, unconfirmed) txs for this market — ticket locks until confirmed/failed.

Effective exposure: `yesExposure = yesQty + openBuyYesQty`, `noExposure = noQty + openBuyNoQty`. Block Buy No if `yesExposure > 0`; block Buy Yes if `noExposure > 0`.

### 2.3 Copy (blocked states)
| Situation | Inline copy (under disabled intent) | Action link |
|---|---|---|
| Holds Yes, tries Buy No | "You hold 40 Yes in this market. Close your Yes position before buying No." | "Sell 40 Yes" (prefills Sell Yes, size = full) |
| Holds No, tries Buy Yes | "You hold 25 No in this market. Close your No position before buying Yes." | "Sell 25 No" |
| Has open Buy Yes orders | "You have open Buy Yes orders (15 contracts). Cancel them before buying No." | "Cancel orders" |
| Has open Buy No orders | mirror | "Cancel orders" |
| Tx pending | "Waiting for your last order to confirm…" | — |
| Holds both (legacy) | Banner: "You hold both Yes and No in this market — likely from another app. You can sell either side here; you can't add to either." | — |

Tooltip on the info icon: "Meridian's trading screen keeps one side per market so your exposure and payoff are unambiguous."

### 2.4 Edge cases
| # | Case | Behavior |
|---|---|---|
| E1 | Flat → open | Both Buy intents enabled. After first fill confirms, the opposite Buy disables. |
| E2 | Switch side (Yes → No) | Requires two steps: Sell all Yes (and cancel Buy Yes orders) → once `yesExposure == 0`, Buy No enables. **No one-click "flip"** in v1 (`OPEN:` PM may want an atomic flip later). |
| E3 | Partial close | Selling part of Yes keeps Buy No blocked until Yes = 0. |
| E4 | Dust | If `yesQty < market.lotSize` (unsellable dust), treat as 0 for blocking, show "Dust: 0.3 Yes (redeemable at settlement)". `TODO(schema)` lot size semantics. |
| E5 | Sell order resting | Resting Sell Yes for full size does **not** unblock Buy No until it fills. |
| E6 | Partial fill of Buy No limit while user also… | Impossible by construction (Buy Yes blocked while Buy No open). |
| E7 | Race: two tabs / devices | Constraint enforced client-side from latest confirmed state + pending txs. Because UI-only, second tab may submit stale; on confirm, recompute and show the legacy "both" banner if it occurred. `OPEN:` Should Schema enforce on-chain? (Recommended: optional on-chain guard in the wrapper instruction.) |
| E8 | Tokens transferred in externally | Constraint recomputed on balance change; may land in "both" state → legacy banner. |
| E9 | Market closed / settled | All intents disabled; only Redeem (§3) available. |
| E10 | Sell size > available (locked in asks) | Max button = `available = held − lockedInSells`; copy "12 locked in open sell orders". |
| E11 | Unsettled Phoenix funds | If outcome/USDC sits in Phoenix as "free" (not withdrawn), count it toward holdings; offer "Settle funds" if Schema requires. `TODO(schema)`. |

### 2.5 Enforcement points (engineering)
- Pure function `getIntentAvailability(position, openOrders, pendingTxs, marketState) → Record<Intent, {enabled, reason?, cta?}>`; unit-test every row of §2.1 and §2.4.
- Used by: Trade ticket, Portfolio quick actions, any deep-link (`?intent=buy-no` must still be validated; fall back to an allowed intent with the blocked copy visible).
- Re-validate immediately before requesting signature.

---

## 3. Settlement countdown

### 3.1 Required market fields
`market.tradingCloseTs`, `market.settleTs` (oracle observation time), `market.resolvedAt`, `market.status`, `market.outcome`, `market.pythFeedId`, `market.strike`, `market.comparator` — `TODO(schema)` names/semantics; UI needs at least close time, observation time, status, outcome.

### 3.2 States
| State | Condition | Countdown display | Trading | Color token |
|---|---|---|---|---|
| **Open** | now < closeTs − 1h | "Closes in 2d 4h 12m" | Enabled | neutral |
| **Closing soon** | closeTs − 1h ≤ now < closeTs | "Closes in 42:18" (mm:ss under 1h, ticking each second) | Enabled; warning chip | amber |
| **Closed — awaiting result** | closeTs ≤ now, not resolved | "Trading closed · Result expected ~4:00 PM CT" (based on settleTs) | Disabled; cancels allowed if program permits (`TODO(schema)`) | neutral-muted |
| **Resolving** | settleTs passed, oracle read pending / tx in progress | "Resolving with Pyth…" spinner | Disabled | neutral-muted |
| **Delayed** | now > settleTs + `RESOLUTION_GRACE` (`OPEN:` e.g. 30m) & unresolved | "Resolution delayed. Funds are safe; result will post when the oracle updates." | Disabled | amber |
| **Settled** | status == resolved | "Settled: **Yes** · AAPL closed $231.42 ≥ $230.00" | Disabled; Redeem enabled | green/red per user result |
| **Voided** (if supported) | `OPEN:`/`TODO(schema)` | "Market voided — collateral returned at 0.50/contract" (rule TBD) | Disabled | neutral |

- Always show absolute time alongside relative: "Closes Oct 16, 3:00 PM CT (in 2d 4h)". Display in user's local zone with abbreviation.
- Countdown derived from **chain time** offset (`getBlockTime` / slot clock vs `Date.now()`); recompute skew every 60s. Never rely solely on local clock for the enable/disable boundary — the program is authoritative; UI disables 5s early (`OPEN:` buffer).
- Equity market hours: if the Pyth feed is stale (publishTime older than threshold) show "Underlying price last updated 3:59 PM CT (market closed)".
- Placement: Trade header (primary), market cards (`02`), portfolio rows (`04`), landing featured cards (`01`).

---

## 4. Payoff copy

### 4.1 Canonical strings
| Context | Copy |
|---|---|
| One-line explainer | "Each contract pays **1.00 USDC** if your side is right at settlement, and **0** if not." |
| Yes definition | "**Yes** pays 1.00 USDC if AAPL is **at or above $230.00** at 3:00 PM CT, Oct 16 (Pyth)." |
| No definition | "**No** pays 1.00 USDC if AAPL is **below $230.00** at 3:00 PM CT, Oct 16 (Pyth)." |
| Ticket preview (buy) | "Cost 24.80 USDC · Pays 40.00 USDC if Yes · Max profit 15.20 USDC · Max loss 24.80 USDC" |
| Ticket preview (sell) | "Receive 26.40 USDC now · You give up 40.00 USDC payout if Yes" |
| Implied probability | "0.62 ≈ 62% implied chance" (label "implied", never "chance of winning") |
| Settled win | "Your 40 Yes won. Redeem 40.00 USDC." |
| Settled loss | "Your 25 No did not win. Payout 0.00 USDC." |
| Fees | "Fees ≈ 0.05 USDC (shown separately; not included in payout)." |

### 4.2 Formulas (pre-fee; fees shown as separate line)
- Buy: `cost = q × p_side`; `payoutIfWin = q × 1.00`; `maxProfit = q × (1 − p_side)`; `maxLoss = cost`.
- Sell: `proceeds = q × p_side`; `forgonePayout = q × 1.00`.
- Market orders: use **book-walked VWAP** for estimate; show "Est." prefix and worst-case price.
- Unrealized P&L (`04`): `q × (mark − avgEntry)` where `mark = mid` of side (fallback last trade). `OPEN:` mark source.

### 4.3 Don'ts
- No "win", "jackpot", "bet" in primary UI (use "pays", "settles", "position"). `OPEN:` PM may allow "win" in settlement result only (used above in "won" — confirm).
- Never present payout as profit. Always pair payout with cost.
- Never imply guaranteed outcome; never round 0.995 implied to "100%".
