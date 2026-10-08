# 08 — Price display: executable vs implied (all surfaces)

Status: Accepted (2026-10-08). Normative for 01/02/03 price display; 06 §1.2 conversion rules unchanged.

## Problem
On Trade (AMZN ≥ 190) the header pills showed **Yes 0.42 / No 0.58**, which is the mid, while the book showed best ask 0.43 and best bid 0.41. An unlabeled mid sitting next to book levels looks like a price you can trade at, but no order is resting there.

## Decision / rules
1. **One quote helper.** Every surface gets its numbers from one pure helper (suggested `lib/market/priceDisplay.ts`). It takes Yes `bestBid`, `bestAsk`, `lastYes` and `tickSize` and returns the four executable prices plus `implied`. Use integer-tick math (`noPriceFromYes` / `bookTransform`); no `Math.round(x*100)/100`.
2. **Buttons and pills show executable prices (top of book, Yes book):**
   | Intent | Price shown | AMZN example (bid 0.41 / ask 0.43) |
   |---|---|---|
   | Buy Yes | best Yes **ask** | 0.43 |
   | Buy No | 1 − best Yes **bid** | 0.59 |
   | Sell Yes | best Yes **bid** | 0.41 |
   | Sell No | 1 − best Yes **ask** | 0.57 |
   Sell prices appear only where sell intents are shown (ticket 2×2). Cards, table and ladder show Buy only.
3. **Mid is only ever shown as "implied", with a label.** Format: `42% implied` (tooltip/long form per 06 §4.1: "0.42 ≈ 42% implied chance"). The mid is never shown as a bare 0.xx price next to Yes/No or book levels. Exception: the book spread row is already labeled. Change it to `Spread 0.02 · 42% implied` so mid has one format everywhere.
4. **Same placement everywhere.** The price lives **on the Buy Yes / Buy No control**, and implied % sits beside it as a separate muted label:
   - **Market card:** replace the "Yes 0.62 · No 0.38" row with `42% implied`. Buttons become `[Buy Yes 0.43] [Buy No 0.59]`.
   - **Markets table:** keep the Yes bid/ask and No bid/ask (derived) columns, since they are labeled book levels. Add an `Implied` column. The Trade cell buttons show prices as on cards (shared `MarketBuyLinks`).
   - **Markets ladder:** columns stay as they are. `Implied` uses the shared helper (today it uses raw `Math.round(yesMid*100)` with no cap). Trade-cell buttons show prices.
   - **Trade header pills:** still the perspective toggle (behavior and `aria-pressed` unchanged). Content becomes `Buy Yes 0.43` / `Buy No 0.59`, followed by a separate `42% implied` label.
   - **Ticket 2×2 intent buttons:** show the price under each label, per the existing 03 §6.1 line (specified but **not built**: buttons render `intentLabel(i)` only).
5. **Accents:** Yes prices use the teal token and No prices use violet, as today. Book bid/ask colors stay as they are. Never paint bid/ask levels with the Yes/No tokens.
6. **Selection states are unchanged.** Adding price text must not alter classes or state: `sel-yes`/`sel-no` + `aria-pressed` on pills, `btn-yes`/`btn-no` + `choice` + `aria-pressed` on ticket intents, `is-selected`/`is-recent` "Last viewed", book row highlight keyed by price (DLV-071), and the D-022 disabled/blocked style. The price inherits the button's existing selected and disabled styling.
7. **Sum copy.** Buy Yes + Buy No = 1.00 + spread (0.43 + 0.59 = 1.02). Never claim they sum to 1.00. Only implied Yes + implied No = 100%.
8. **Caps.** Executable prices are book levels and stay within [minPrice, maxPrice] (0.01–0.99). Implied % is clamped to 1%–99% with the existing `impliedLabel` rule (never round 0.995 to 100%). A half-tick mid is allowed internally; it only renders as a whole %.

## Surfaces in scope
Market card (`MarketCard`), Markets table and ladder (`MarketsClient` + `MarketBuyLinks`/`MarketBuyCell`), Trade header pills (`TradeClient`), ticket intent selector (`TradeTicket`), and the order-book spread row (`OrderBook`). Landing featured card follows the card rules. Cards, table and ladder use the indexer/Phoenix snapshot. Trade uses the live book. Both go through the same helper.

## Fallbacks
| Book state | Executable prices | Implied |
|---|---|---|
| Bid + ask | per rule 2 | mid → `NN% implied` |
| Bid only (no Yes asks) | Buy Yes `—`, Sell No `—`; Buy No = 1 − bid; Sell Yes = bid | `NN% implied (last trade)` if `lastYes`, else `—` |
| Ask only (no Yes bids) | Buy No `—`, Sell Yes `—`; Buy Yes = ask; Sell No = 1 − ask | same as above |
| Empty book | all `—`; book shows "No orders yet" | last-trade fallback as above, else `—` |
| Closed / settled | no executable prices; existing countdown/settled UI ("Settled: Yes", proof link) | hidden |
| Stale (> 30 s) | existing "Prices delayed" chip | same |
- A `—` price does **not** disable a button. Only 06 §2 constraints and the countdown or banner disable it, so a limit order is still possible. Tooltip on a `—` side: "No sellers right now — set a limit price" (Buy) / "No buyers right now" (Sell).
- One-sided mid: `applyTopOfBook` in `lib/indexer/phoenixQuotes.ts` currently sets `yesMid` to the one side that exists. Change it so mid stays undefined unless both sides exist. Update the test that expects `yesMid 0.7` for bid-only.
- Remove the Trade header fallback `?? 0.5` (`TradeClient.tsx`). Never show an invented 0.50.

## Out of scope (Eng owns)
Phoenix wiring and quote subscriptions; Buy No mint+ask and Sell No bid+`merge_pair` composition (06 §1); VWAP / worst-price preview math; Portfolio Mark (04 / 06 §4.2 mark = mid, fallback last). Mark is already a labeled column; it is left unchanged here.

## Acceptance
- [ ] AMZN fixture (bid 0.41 / ask 0.43): the card, table, ladder, header pills and ticket all show Buy Yes 0.43 / Buy No 0.59 and `42% implied`. The ticket also shows Sell Yes 0.41 / Sell No 0.57.
- [ ] Nothing renders an unlabeled mid; a `grep` finds no `yesMid` formatted with `formatOutcomePrice` outside the helper.
- [ ] One-sided and empty books render per the fallback table; no `0.50` placeholder.
- [ ] Unit tests for the helper use integer ticks, cover both perspectives, and cover tickSize ≠ 0.01.
- [ ] Selection and disabled visuals are pixel-identical apart from the added price text (screenshot diff of `meridian-selection-*` shots).
