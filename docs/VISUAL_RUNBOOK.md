# Meridian visual test runbook (click-by-click)

## Tester setup (do this first)

For a first-time tester who isn't the operator. Do the part for the track you're testing (or both), then go on to **Before you start**.

> **Never share your seed phrase (Secret Recovery Phrase) or private key** with anyone: not the operator, not an agent, not in chat or email. Nobody needs them. The only thing you ever send is your **public** wallet address.

**Track A: localnet, on the operator's box**

1. Ask the operator to **update the box to the latest `main`** and restart the local validator and the web app. Ask which commit (SHA) it's on and write it down.
2. Open the **box desktop**: the operator's shared computer, which you can open from the Grok Bot app. The app at http://localhost:3000 and the **Localnet Dev Wallet** only exist there. `localhost:3000` on your own computer won't work.
3. In the browser on the box desktop, open http://localhost:3000 and carry on with 0.1–0.2 below. There's nothing to install: the Localnet Dev Wallet signs by itself.

**Track B: devnet staging, Phantom**

1. Install the **Phantom** browser extension, only from the official site https://phantom.com.
2. Create a new wallet (or import one you only use for testing). Phantom shows a seed phrase: write it down on paper and keep it to yourself. Never type it into a website, chat or email.
3. Phantom → **Settings → Developer Settings** → turn on **Testnet Mode** → choose **Solana Devnet**.
4. This first account is **wallet A**. In Phantom's account menu, add a **second account** and name it **wallet B**.
5. Copy each account's **public** Solana address (32–44 letters and digits) and send both to the operator, labelled **A** and **B**.
6. Wait until the operator has funded them (the operator's side is [`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md) **1.4** for wallet A and **1.5** for wallet B). Expect about **2 SOL** on wallet A (at least 1) and about **0.5 SOL** on wallet B, plus **mUSDC** on both (wallet B gets 1,000). This is devnet: none of it has real value.
7. Recognise **mUSDC**. Phantom may show it as an **unknown token** with no name or logo (look in the token list, including hidden tokens, if it isn't on the main screen). Open it and compare its mint / token address with `GEBRsT3Nc3PaEio2qf3x4JUgFtPSYXr7bmVitMuzMBXq`: it must **start with `GEBRsT3N`** and **end with `MXq`**. Any other token isn't the test token, so don't use it.

**Ready when:** **[A]** the box is on the latest `main` and http://localhost:3000 opens on the box desktop · **[B]** Phantom is on Devnet, and wallets A and B each show SOL (A ≥ 1, B ~0.5) and mUSDC (`GEBRsT3N…MXq`).

---

| Field | Value |
| --- | --- |
| **Owner** | Meridian Testers |
| **For** | Debu, testing by hand. No terminal needed except where a step says **[operator]** |
| **Written against** | main `7219ac1` (`7219ac1425c7d4197c3830045eadc1fcc52db693`, Merge !73 Phoenix pause at expiry, on top of !72 `578af22`). Every on-screen string below is copied from `apps/web/src` at that SHA. Updated for the !74 Reviewer nits at `fc862c2` (docs only, same code) |
| **Track A** | **Localnet** at http://localhost:3000 with the **Localnet Dev Wallet**. Use it now: real localnet markets with Phoenix books and mock Pyth prices. The operator opens/closes sim sessions and settles from scripts (`docs/SIM_LIFECYCLE.md`) |
| **Track B** | **Devnet staging** at https://web-production-77fbb.up.railway.app with **Phantom on devnet** (wallet A), plus **wallet B** for fills. Needs the program deployed and the markets bootstrapped (DLV-077). Full detail and operator steps: [`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md) |
| **Not in scope** | Deploying, Railway changes, starting validators. This runbook is read-and-click |

## How to use this

- Each step has **Click / Do**, **You should see**, and a **Pass** box. Tick `[x]` when what you see matches. When it doesn't, write the step number and what you saw (a screenshot helps).
- **[A]** = Track A only, **[B]** = Track B only, no tag = both tracks.
- Use **whole numbers** for sizes (1 contract = 1 lot).
- Toasts appear bottom-right. A trade first shows `Submitted — confirming…`, then the success toast **only after the transaction confirms**. A failure shows `Transaction failed on-chain (…)`; a timeout shows `Sent but not confirmed yet — check the explorer before retrying`.
- `0.xx` in a step means "whatever the book shows".

## Before you start

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 0.1 | **[A]** Make sure the operator has the local validator and the web app running. Then open http://localhost:3000. | The landing page loads. The header chip reads **localnet**. | [ ] |
| 0.2 | **[A]** Click **Select Wallet** (top right) → **Localnet Dev Wallet**. | The wallet button shows an amber **DEV** icon and a short address. No Phantom popup: the dev wallet signs by itself (localnet only). | [ ] |
| 0.3 | **[B]** In Phantom → Settings → Developer Settings, turn on **Testnet Mode** and choose **Solana Devnet**. Open the staging URL. Click **Select Wallet** → **Phantom** → approve. | The header chip reads **devnet**. The button shows your short address. There is **no** "Localnet Dev Wallet" option. | [ ] |
| 0.4 | **[B]** Check balances in Phantom for wallet A and wallet B. | At least ~0.5 SOL and some **mUSDC** (shows as an unknown token, mint `GEBRsT3N…MXq`) in each. If either is missing, ask the operator (STAGING_TEST_PLAN 1.4 / 1.5). | [ ] |

---

## 1. Landing page and market list (cards, table, ladder)

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 1.1 | Open `/` (the home page). | Headline **Trade yes/no outcomes on stock prices.** with buttons **Browse markets** and **How it works**. A featured market card on the right. Sections **How it works** (cards `1. Pick a market`, `2. Buy Yes or No`, `3. At settlement`) and **Closing soon** with a **View all** link. With no open markets: `No markets are open right now. Check back soon.` | [ ] |
| 1.2 | Click **Browse markets**. | Page **Markets** with the line `One book per market — Yes and No are two prices on the same Phoenix book.` A search box `Search ticker or question`, a status dropdown (**Open**, Closing soon, Closed, Recently settled, All), a sort dropdown (**Closing soonest**, Volume 24h, Open interest, Newest), and a **Cards / Table / Ladder** toggle. | [ ] |
| 1.3 | Look at one **card** (default view). | An underlying chip (e.g. `AAPL`), a countdown, a title like `AAPL ≥ $305.00 at close Oct 9`, **Yes 0.xx** and **No 0.xx**, a line like `0.50 ≈ 50% implied chance`, a distance line (see §8), `24h vol … USDC · OI …`, and **Buy Yes / Buy No** buttons. | [ ] |
| 1.4 | Click **Table**. | The URL gains `?view=table`. Columns **Underlying, Question, Yes bid/ask, No bid/ask, Last, 24h vol, OI, Closes, Status, Trade**. | [ ] |
| 1.5 | Click **Ladder**. | The URL gains `?view=ladder`. One block per underlying + expiry (e.g. `AAPL · Oct 9  underlying $…`) with columns **Strike, Yes bid, Yes ask, No bid, No ask, Implied, Vol, Trade**. The strike nearest the underlying price is tinted; hovering it shows `Nearest strike to underlying`. | [ ] |
| 1.6 | Click an **Underlying** chip (e.g. `AAPL`), then an **Expiry** chip, then **Any**. Type `NVDA` in search. | The list filters each time and the URL updates. With nothing matching: `No markets match these filters.` | [ ] |
| 1.7 | **[B]** Before bootstrap only (optional). | `No markets on Solana devnet yet.` (or **Markets unavailable** on an RPC error). No sample markets. | [ ] |
| 1.8 | **[A]** If you ever see `Showing fixture markets (indexer/RPC unavailable or empty)…` | The app found no real localnet markets and is showing samples. Tell the operator. That's not a test failure of the UI. | [ ] |

## 2. Selection highlights everywhere

The rule (`app/globals.css`): whatever is selected gets a blue ring/tint, and toggles also get a **✓**, so you can tell what's selected without relying on colour.

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 2.1 | On `/markets`, click each of **Cards / Table / Ladder** and a couple of filter chips. | The active view button and every active chip are tinted with a **✓** in front. Inactive ones are plain. | [ ] |
| 2.2 | Open a market, then come back to `/markets` (cards, table and ladder). | That market has a **Last viewed** chip and a highlighted border (card) or a tinted row with a blue left bar (table / ladder). | [ ] |
| 2.3 | On a trade page, click **Buy Yes**, then **Limit**. | The chosen intent shows a **✓** and a tint; **Market/Limit** shows which is on. Intents you can't use look dashed and grey. | [ ] |
| 2.4 | Click the **Yes 0.xx** / **No 0.xx** price buttons in the trade header. | The pressed one is highlighted, and the book title switches between `Order book · Yes` and `Order book · No`. | [ ] |
| 2.5 | Click the **Position / Open orders / Fills** tabs, the Portfolio tabs, and the History type tabs. | The selected tab is highlighted. The current page in the header nav (**Markets / Portfolio / History**) is highlighted too. | [ ] |
| 2.6 | Click a book row (more in §4). | The row gets a tint and a blue left bar. Clicking the same row again removes it. | [ ] |

## 3. Trade page layout

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 3.1 | Open a market with a book. Use a wide window (≥ 1024 px). | Top: `← Markets`, the question (e.g. `Will AAPL close at or above $305.00?`), an underlying line `AAPL $… · Pyth · Ns ago · 24h … · OI …` (**[A]** shows `mock Pyth`), **Yes / No** price buttons and the countdown `Closes in …`. Left column: **Chart (stub)**, then **Order book · Yes** (`Spread 0.xx · Mid 0.xx`, columns Price / Size / Total, footer `Live Phoenix V1 book (Yes/USDC) — refreshes every 4s.`), then the **Position / Open orders / Fills** tabs and **Rules & resolution**. Right column: **Order ticket** (it stays visible when you scroll). | [ ] |
| 3.2 | Look at the ticket. | Buttons **Buy Yes / Sell Yes / Buy No / Sell No**, **Market / Limit**, `Size (contracts)`, a payoff box (§8), the submit button (e.g. `Buy Yes 10`, or `Connect wallet` when disconnected) and the line `Each contract pays 1.00 USDC if your side is right at settlement, and 0 if not.` When connected: `Wallet USDC <balance>`. | [ ] |
| 3.3 | Flat wallet: the **Position** tab. | `No position. You can buy Yes or No.` | [ ] |
| 3.4 | Scroll to **Rules & resolution**. | It ends with `marketId … · program 9Rb7nx… · phoenix <pubkey>`. `phoenix unset` means the market has no book: trading buttons read `Phoenix not configured — …`. | [ ] |

## 4. Order book row click syncs the ticket

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 4.1 | With **Yes** perspective, click an **ask** row (upper half, e.g. 0.51). | The row highlights. The ticket switches to **Limit**, the price becomes **0.51**, and the intent becomes **Buy Yes**. | [ ] |
| 4.2 | Click a **bid** row (lower half, e.g. 0.49) while you hold no Yes. | The row highlights and the price becomes 0.49. **Sell Yes** is unavailable when you hold nothing, so the intent stays as it was and only the price is filled. | [ ] |
| 4.3 | Click the same row again. | The highlight goes away. | [ ] |
| 4.4 | Switch the header to **No** and click an ask row. | The book shows No prices (= 1.00 − Yes). The ticket gets **Buy No** at that No price. | [ ] |
| 4.5 | Click a row in the book, then press ↓ / ↑ on the keyboard. | Focus moves row by row. | [ ] |

Reference shots: `meridian-orderbook-highlight.png`, `meridian-orderbook-highlight-book.png`.

## 5. Buy Yes, Sell Yes, Buy No, Sell No (Market and Limit)

Start flat on a market with a book. Use size **5**. (The full table with exact balances is STAGING_TEST_PLAN §3.)

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 5.1 | **Buy Yes · Market · 5** → click `Buy Yes 5` (approve in Phantom on [B]). | Before you submit: `Market fills at best Yes 0.xx (up to 0.yy).` Then `Submitted — confirming…`, then `Submitted phoenix-only (bid Yes @ … × 5). · <sig>…`. Position **Yes 5**. Fills tab gets a **Buy Yes** row. | [ ] |
| 5.2 | **Buy Yes · Limit · 5** at or above the best ask (click an ask row) → `Buy Yes 5 @ 0.xx`. | It fills right away. **Yes 10**. Nothing new in Open orders. | [ ] |
| 5.3 | **Sell Yes · Market · 5** → `Sell Yes 5`. | `Submitted phoenix-only (ask Yes @ … × 5)…`. **Yes 5**. | [ ] |
| 5.4 | **Sell Yes · Limit · 5** at or below the best bid (click a bid row) → `Sell Yes 5 @ 0.xx`. | It fills. Position back to `No position. You can buy Yes or No.` | [ ] |
| 5.5 | **Buy No · Market · 5** → `Buy No 5`. | Ticket note `Buy No: mint pair then ask Yes @ 0.xx (multi-ix tx).` The toast includes `Submitted mint-then-phoenix …`. Position **No 5**. | [ ] |
| 5.6 | **Buy No · Limit · 5** at a crossing No price (No perspective, click an ask row) → `Buy No 5 @ 0.xx`. | It fills. **No 10**. | [ ] |
| 5.7 | **Sell No · Market · 5** → `Sell No 5`. | Ticket note `Sell No (market): bid Yes then merge_pair in one tx.` The toast includes `Bid + merge_pair packed in one tx (immediate Sell No).` **No 5**, no leftover Yes. | [ ] |
| 5.8 | **Sell No · Limit · 5** at a crossing No price → `Sell No 5 @ 0.xx`. | Ticket note `Sell No (resting): bid Yes only — merge_pair on fill not automatic yet.` After the fill you hold **Yes 5 + No 5** ("Both sides held"). This is the known limit DLV-069 (box at the end), so Pass = this behaviour. Unwind with **Sell Yes · Market · 5** and **Sell No · Market · 5**. | [ ] |
| 5.9 | **Buy Yes · Market · 100000** (more than the book has). | `No fill: the book doesn't have 100000 Yes at 0.xx or better. Nothing was traded — try a smaller size or a Limit order.` No balance change. (If you reject in Phantom: `Wallet rejected the transaction.`) | [ ] |

## 6. Whole-lot size validation

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 6.1 | On **Buy No · Market**, type size **2.5**. | Red text under the size box: `Size must be a whole number of contracts.` The **Buy No** button is disabled, and no wallet popup can open. | [ ] |
| 6.2 | Type **0.5**, then try **Sell No · Market · 2.5**. | The same message, and the button stays disabled. | [ ] |
| 6.3 | Type **0**. | `Enter a size greater than 0.` and a disabled button. | [ ] |
| 6.4 | **Limit**: clear the price box. | The payoff box reads `Enter a size and a price between 0.01 and 0.99.` | [ ] |

## 7. Opposite-side block (you can't hold Yes and No in the same market)

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 7.1 | Hold **Yes 5** (Buy Yes · Market · 5). Look at **Buy No**. | Disabled (dashed, grey). Selecting it shows `You hold 5 Yes in this market. Close your Yes position before buying No.` with a **Sell 5 Yes** button. | [ ] |
| 7.2 | Click **Sell 5 Yes**. | The ticket switches to **Sell Yes**, size 5. | [ ] |
| 7.3 | On `/markets`, find that market's card. | A badge `You: Yes 5`. Buy No is disabled; hovering shows `You hold Yes — sell it first`. | [ ] |
| 7.4 | Open `/markets/<that id>?intent=buy-no`. | A banner with the blocked message, and the ticket picks an allowed intent. | [ ] |
| 7.5 | Flip it: sell the Yes, then **Buy No · Market · 5**. | **Buy Yes** disabled: `You hold 5 No in this market. Close your No position before buying Yes.` Card badge `You: No 5`. | [ ] |
| 7.6 | Resting version: place **Buy Yes · Limit · 10** below the ask (it rests), then look at **Buy No**. | `You have open Buy Yes orders (10 contracts). Cancel them before buying No.` | [ ] |

## 8. Payoff line and distance to strike

On a market like **AAPL ≥ 305, Oct 9** (fees 0 on staging):

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 8.1 | **Buy Yes · Limit · 10 @ 0.45** (don't submit). | `If AAPL closes ≥ $305.00 on Oct 9 you get $10.00 (+$5.50). If not, you lose $4.50.` | [ ] |
| 8.2 | **Sell Yes · Limit · 10 @ 0.45**. | `You get $4.50 now. If AAPL closes ≥ $305.00 on Oct 9 you give up $10.00 (−$5.50 vs holding). If not, they would have paid $0.00.` | [ ] |
| 8.3 | **Buy No · Limit · 10 @ 0.55**. | `If AAPL closes below $305.00 on Oct 9 you get $10.00 (+$4.50). If not, you lose $5.50.` | [ ] |
| 8.4 | Switch to **Market**. | The sentence recomputes at the live best price, matching the `Market fills at best …` line. With an empty book: `No live price on the book for a market order yet.` | [ ] |
| 8.5 | Read the line under the sentence (and the small one on each market card). | `AAPL $<price> · needs +x.x%` (below strike), `is x.x% above strike` (above), or `at strike (Yes if ≥)`. If the price feed can't be read: `AAPL — · distance to strike —`. | [ ] |

Reference shots: `meridian-payoff-line-ticket.png`, `meridian-payoff-line-sell-yes-ticket.png`, `meridian-payoff-line-buy-no-ticket.png`, `meridian-payoff-line-trade.png`, `meridian-payoff-distance-cards.png`.

## 9. Resting order filled by the other wallet, Phoenix balance, Withdraw, Cancel, Cancel all

**[B]**: use wallet B in Phantom. **[A]**: the dev wallet is a single key, so ask the operator to cross your order from a second localnet key, or do this section on Track B.

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 9.1 | Wallet A, flat: **Buy Yes · Limit · 10** at the middle tick (e.g. **0.50** on a 0.49 / 0.51 book). | Toast `Submitted phoenix-only (bid Yes @ 0.50 × 10)…`. Within a few seconds the book shows 10 at 0.50. **Open orders (1)**: `Buy Yes · 0.50 · 10 · [Cancel]`, with the note `Resting buys count toward the one-side rule. Cancelling returns funds to your wallet.` | [ ] |
| 9.2 | Switch to **wallet B** (reconnect). **Buy Yes · Market · 4**, then **Sell Yes · Limit · 4 @ 0.50** (click A's 0.50 row). | B's sell fills against A's bid. The 0.50 level drops from 10 to **6**. | [ ] |
| 9.3 | Back to **wallet A** → Position tab. | Position **Yes 4 (4 in Phoenix)**. Card **Phoenix trader account**: `Free 4 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC` with **Withdraw to wallet**. | [ ] |
| 9.4 | Open **Portfolio**. | Positions card with chips `YES 4` and `4 Yes in Phoenix`. Tile **In Phoenix (withdrawable)** = `0.00 USDC · 4 Yes`. Tab **Phoenix balances (1)** shows the same seat and **Withdraw to wallet**. | [ ] |
| 9.5 | Trade page → **Withdraw to wallet** → approve. | `Withdrew your Phoenix balance to your wallet. · <sig>…`. Wallet Yes = 4. The 6 @ 0.50 order **is still resting**. | [ ] |
| 9.6 | Place one more resting order (e.g. **Buy Yes · Limit · 1 @ 0.45**). Open orders now has 2 rows and a **Cancel all (2)** button. Click **Cancel** on one row → approve. | `Cancelled 1 order; funds returned to your wallet. · <sig>…`. That row disappears. | [ ] |
| 9.7 | Add a second order again so **Cancel all (2)** shows → click it → approve. | `Cancelled 2 orders; funds returned to your wallet. · <sig>…`. Open orders: `No resting orders on this market.` | [ ] |
| 9.8 | **Portfolio → Phoenix balances**. | With nothing left anywhere: `No Phoenix trader accounts yet — one is created with your first limit order.` | [ ] |

## 10. Auto-sweep disclosure

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 10.1 | Repeat 9.1–9.3 so wallet A has **4 free Yes in Phoenix** plus a resting 6 @ 0.50. **Don't** withdraw. Set up **Buy Yes · Market · 1**. | Before you submit, the ticket shows `Also moves 4 Yes from your Phoenix account to your wallet.` | [ ] |
| 10.2 | Submit and approve. | `Submitted phoenix-only (bid Yes @ 0.xx × 1). Also moved 4 Yes from your Phoenix account to your wallet. · <sig>…`. Wallet Yes +5. Seat free = 0. **The 6 @ 0.50 order is still resting.** | [ ] |
| 10.3 | (Optional) With free seat funds again, try **Buy Yes · Market · 100000**. | The `Also moves …` line shows first, then the `No fill: …` error. **Seat unchanged**: a failed order also undoes the sweep (same transaction). | [ ] |
| 10.4 | Clean up: **Cancel** the 6 @ 0.50 order, then sell your Yes. | Both wallets flat. | [ ] |

## 11. Portfolio tabs and History (incl. CSV)

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 11.1 | Hold something, then open **Portfolio**. | Tiles **Portfolio value**, **USDC in wallet**, **Positions (mark)**, **In Phoenix (withdrawable)**, **Redeemable now**. Footnote `On-chain: wallet token accounts + Phoenix trader accounts. Marks use the Yes mid.` It must **not** say `Localnet fixture mode — demo balances, not on-chain.` | [ ] |
| 11.2 | Click **Positions**, **Open orders**, **Phoenix balances**, **Redeemable**. | Positions: one card per market you hold (`YES 5` / `NO 5`, **Sell** / **Trade**). Open orders: your resting orders, or `No resting orders on Phoenix.` Phoenix balances: seats with leftovers, or the "no trader accounts" line. Redeemable: `Nothing to redeem.` until a market you won settles. | [ ] |
| 11.3 | Disconnect the wallet and open Portfolio. | `Connect a wallet to see your positions.` | [ ] |
| 11.4 | Open **History**. | `Reading your transactions…`, then rows with **Time, Type, Market, Intent / Outcome, Price, Size, USDC, Yes / No, Tx**. Tabs **All, Fills, Orders, Cancels, Withdraw / mint / merge, Settlements, Redemptions**. A brand-new wallet: `No Meridian activity for this wallet yet.` | [ ] |
| 11.5 | Click a **Tx** link. | Solana Explorer opens on that transaction (**[B]** with `?cluster=devnet`). | [ ] |
| 11.6 | Click **Export CSV**. | A CSV downloads. The page notes `CSV: ISO-8601 UTC + America/Chicago.` | [ ] |
| 11.7 | Look for wallet B's fill of your resting order (from 9.2) in **wallet A's** History. | It is **not** listed as a fill (known limit, box at the end). You see it only through your withdraw/cancel rows and the seat balance. | [ ] |

Reference shots: `meridian-selection-portfolio.png`, `meridian-selection-portfolio-orders.png`, `meridian-selection-history.png` (older builds: use them for the highlight style; the tile names have changed since).

## 12. "Checking your balances…" and Retry

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 12.1 | Reload a trade page with the wallet connected and watch the ticket for the first second. | The intents are briefly locked with `Checking your balances…`, never "enabled as if flat". | [ ] |
| 12.2 | (Optional, hard to stage) If the first balance read fails (e.g. the RPC is rate-limiting), look at the ticket and at the market cards. | `Couldn't read your balances. Retrying…`, with a **Retry** button on the ticket. Buy buttons stay locked (they fail closed). Clicking **Retry** re-reads. | [ ] |

## 13. Expiry: the book is paused, cancel/withdraw still work, trading is blocked (!73)

**What changed in !73:** at the moment a market expires, a dedicated **pauser** key tells the Phoenix **Seat Manager** to set the book to **Paused** (`ChangeMarketStatus → Paused`). On a paused book, Phoenix refuses **every new order** (posts and crosses) but still allows **cancel** and **withdraw**. Nobody can trade against leftover orders after the price is known. (The pauser key could also set the book Active again; automation re-checks paused books and re-pauses with an alert, review mr72-73 M1/M2.) The UI shows **no** "Paused" badge, so the status check is an operator/Explorer step.

**[B]** (the 20-minute AAPL ≥ 300 market, STAGING_TEST_PLAN 1.7 / 7.3b / 7.3c). **[A]**: localnet books aren't handed to the pauser by default, so skip unless the operator pauses a localnet book with `ops-cli pause-once`.

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 13.1 | **Before expiry**, on the short market, with **wallet A**: place **Buy Yes · Limit · 2** at **0.50** (the middle tick between the 0.49 bid and the 0.51 ask), then **Buy Yes · Limit · 1** at **0.44** and at **0.43**. | **Open orders (3)**. Your 2 at 0.50 is the best bid. | [ ] |
| 13.2 | **Before expiry: partial fill.** Switch Phantom to **wallet B** (holding No or nothing on this market) and do **Buy No · Market · 1**. Switch back to wallet A. After this, **don't place any new order** with wallet A on this market (a new order would sweep the Phoenix balance to the wallet). | Buy No sells 1 Yes into the best bid, so A's 0.50 level drops from 2 to **1**. A's Position tab: card **Phoenix trader account** `Free 1 Yes · 0.00 USDC — In orders 0 Yes · 1.37 USDC` with **Withdraw to wallet**. (No wallet B? Carry on and mark 13.6 N/A.) | [ ] |
| 13.3 | Watch the page through expiry. | About **5 s before** expiry the ticket becomes **Trading closed** with `Redeem winning positions from Portfolio after settlement.` After expiry the countdown reads `Resolving with Pyth…`. The book and the Open orders tab are still visible (the market isn't settled yet). On `/markets` the market moves to Status **Closed**. | [ ] |
| 13.4 | **[operator]** Confirm the book is **Paused**, one of: `ops-cli pause-status --state $STATE` (no pauser key needed), or `solana account <phoenix pubkey> -u devnet --output-file /tmp/hdr.bin && xxd -s 8 -l 8 /tmp/hdr.bin`. | The 20-min book shows `status: "Paused"`, or `xxd` prints `0300 0000 0000 0000` (status **3**), paused by the pauser within seconds of expiry. A `[pause] ALERT …` line is a **FAIL**. | [ ] |
| 13.5 | Try to trade on the short market. | You can't: the ticket is **Trading closed** with no buttons. (If another app or script tries, Phoenix rejects it with `Post only order is not allowed, market status is Paused` or `FOK and IOC orders are not allowed, market status is Paused`.) | [ ] |
| 13.6 | **Withdraw first:** Position tab → **Phoenix trader account** → **Withdraw to wallet** → approve. | `Withdrew your Phoenix balance to your wallet. · <sig>…`. Wallet Yes +1, the card shows `Free 0 Yes`, and all three orders are **still resting**. If 13.2 didn't happen there's nothing to withdraw (no button): tick **N/A**, not Pass. (Each Cancel below also sweeps the Phoenix balance, which is why Withdraw goes first.) | [ ] |
| 13.7 | Open orders → **Cancel** on the 0.50 order (1 left) → approve. | `Cancelled 1 order; funds returned to your wallet. · <sig>…`. mUSDC +0.50. | [ ] |
| 13.8 | Click **Cancel all (2)** → approve. | `Cancelled 2 orders; funds returned to your wallet. · <sig>…`. mUSDC +0.87. `No resting orders on this market.` | [ ] |
| 13.9 | Note anything that filled your orders after expiry. | Nothing should fill after the pause. A fill **between** expiry and the pause landing is the known short window; write down the time. | [ ] |

If 13.6–13.8 fail on a paused book, that's a **blocker for !73**: report it.

## 14. Settle (Pyth first, admin fallback)

**[B]** The operator pipeline settles the 20-min market (STAGING_TEST_PLAN 7.5 / 7.6). From expiry + 90 s it tries, in order:
1. **Pyth pull settle**: the market's **sponsored** Pyth price account if it already holds the expiry price, otherwise the **Hermes** expiry price posted through the Pyth receiver (needs the Hermes API key). Signed by the low-balance **settler** key.
2. The legacy permissionless settle against the sponsored account (settler).
3. From expiry + 330 s, if still unsettled: **`admin_settle`** by the config authority at the **Hermes AAPL price at expiry** (publish time within 10 min of expiry). If Hermes has no such price (off-hours, key not entitled), the pipeline **refuses** to settle on its own and waits for the operator to supply the real expiry price **with its source** (e.g. the official close); the source is logged. It never uses the stale shard-0 account price (Reviewers mr72-73 M3). Checked 2026-10-08: the current `PYTH_HERMES_API_KEY` gets HTTP 403 **"Not entitled … asset type 'equity'"** for the AAPL feed (crypto feeds return 200), so until the key's plan includes equities, both the Hermes pull settle and the Hermes fallback price refuse and the **operator price** path is what settles.

**[A]** The operator closes the sim session and settles against the mock Pyth price (`docs/SIM_LIFECYCLE.md`).

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 14.1 | **[B]** Ask the operator for the `settle path:` log line and the settle tx signature. | `PULL_SETTLE_OK via=sponsored` or `via=posted` (Pyth), or `admin_settle price=…` (fallback). | [ ] |
| 14.2 | Reload the market page after settle. | Countdown `Settled: Yes · AAPL closed $X ≥ $300.00` (or `Settled: No · AAPL closed $X < $300.00`). Chart and book are gone. The **Settlement proof** card shows instead. The ticket still reads **Trading closed**. | [ ] |
| 14.3 | If nothing settles for 30 min after expiry. | The countdown reads `Resolution delayed. Funds are safe; result will post when the oracle updates.` Tell the operator. | [ ] |

## 15. Settlement proof card, Recently settled, Redeem

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 15.1 | Settled market page → **Settlement proof** card. | Chip **Yes wins** / **No wins**, the line `AAPL $X ≥ $300.00 → Yes wins` (or `< … → No wins`), and rows **Settlement price**, **Confidence**, **Strike** `$300.00 (Yes if ≥, D-005)`, **Settled at** `… · slot N`, **Settle tx** `…↗`, **Pyth feed id** `0x…↗` · `price account …↗`. `On-chain outcome does not match price ≥ strike — investigate.` must **not** appear. | [ ] |
| 15.2 | Read the price label and the note under the rows. | **Pyth settle:** price `$X Pyth` (**[A]** `$X mock Pyth (localnet)`), a Confidence like `± $0.04`, and the note `Pyth publish time isn't stored on-chain; settle required it within 150 slots (D-005).` **Admin settle:** `$X admin fallback` (the mainnet Pyth price read at about expiry + 330 s, see 14), Confidence `n/a (admin settle)`, and the note `Settled by admin fallback (no Pyth read; price checked against strike on-chain).` | [ ] |
| 15.3 | Click **Settle tx ↗**. | Explorer opens the operator's settle signature. If the RPC has pruned it: `Settle transaction not found in RPC history (pruned or not yet indexed); values are from the market account.` | [ ] |
| 15.4 | Go to `/markets`. | A chip **Recently settled (N)**. Click it: the settled market is listed with **View settlement proof →** instead of Buy buttons. | [ ] |
| 15.5 | With the **winning** wallet: look at the header. | A dot next to **Portfolio** (hover: `Redeemable: N.NN USDC`). | [ ] |
| 15.6 | **Portfolio → Redeemable (1)** → **Redeem N.00 USDC** → approve. | `Redeeming…`, then `Redeem submitted · <sig>…`, and an Explorer tab opens. mUSDC +N. The row disappears (`Nothing to redeem.`) and the header dot clears. | [ ] |
| 15.7 | With the **losing** wallet: open the market's Position tab. | `Your side did not win. Payout 0.00 USDC.` No Redeem row. | [ ] |
| 15.8 | **History → Settlements / Redemptions**. | A `settlement · Result: Yes` (or `No`) row and a `redemption · Redeem Yes` (or `No`) row with `+N.00`. | [ ] |

Reference shots: `meridian-settle-proof-card.png` (Pyth settle, localnet), `meridian-settle-proof-admin-card.png` (admin fallback), `meridian-settle-proof-trade.png`, `meridian-recently-settled.png`.

## 16. 404 pages

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 16.1 | Open `/markets/not-a-market`. | **Market not found**, `The page or market you requested does not exist.` and a **Browse markets** link. On [B], `curl -sI <staging>/markets/not-a-market` prints a `404` status line. | [ ] |
| 16.2 | **[B]** Open `/markets/fixture-anything`. | Same **Market not found** page (HTTP 404). A sample/fixture market showing up is a **FAIL**. | [ ] |
| 16.3 | **[B]** Open `/api/localnet-dev-wallet`. | `{"error":"not found"}` (HTTP 404). **Anything containing `secretKey` is a blocker: stop and report.** | [ ] |
| 16.4 | **[A]** (Optional) Check only the **HTTP status** of the same URL on localhost, in a terminal: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/localnet-dev-wallet`. **Don't open this URL in the browser** and don't run curl without `-o /dev/null`: on localnet it returns the dev wallet's secret key. | Prints only a number: `200` when the Localnet Dev Wallet is enabled (localnet only), `404` when it's off. Never print, copy or share the response body. | [ ] |

## 17. Mobile viewport

Use a phone, or Chrome DevTools → device toolbar → **390 × 844**.

| # | Click / Do | You should see | Pass |
| --- | --- | --- | --- |
| 17.1 | Open `/`. | The hero stacks into one column. The top nav links are hidden and a **bottom bar** shows **Markets / Portfolio / History** (current page highlighted, redeem dot on Portfolio when you can redeem). | [ ] |
| 17.2 | Open `/markets` in each of **Cards / Table / Ladder**. | Cards stack one per row. Table and ladder scroll sideways inside their box, and the page itself never scrolls sideways. | [ ] |
| 17.3 | Open a trade page. | One column in this order: header (question, Yes/No, countdown) → **Order ticket** → order book → chart stub → Position / Open orders / Fills → Rules. Nothing is cut off. The bottom bar doesn't cover the submit button once you scroll. | [ ] |
| 17.4 | Place a small order on mobile (5.1). | Same toasts as on desktop. | [ ] |

Reference shots: `meridian-trade-layout-mobile-390x844.png` (mobile), `meridian-trade-layout-desktop-1280x800.png` and `meridian-trade-layout-desktop-1280x800-full.png` (desktop).

---

## What good looks like (screenshots on the box)

These are in `/workspace/` on the shared box and were taken on **localnet on 2026-10-07**. Some come from builds before !63/!67, so a few labels differ from today's app (e.g. the old Portfolio tiles, and the pre-payoff "Cost … · Pays …" ticket box in the order-book shots). Where a screenshot and a step disagree, **the step text wins**.

| Use case | Screenshot |
| --- | --- |
| 1 Market list: cards / table / ladder, with "You:" badges | `meridian-markets-exposure.png`, `meridian-markets-exposure-table.png`, `meridian-markets-exposure-ladder.png` |
| 2 Selection highlights | `meridian-selection-markets.png`, `meridian-selection-markets-table.png`, `meridian-selection-trade.png`, `meridian-selection-trade-full.png`, `meridian-selection-wallet-menu.png`, `meridian-selection-portfolio.png`, `meridian-selection-portfolio-orders.png`, `meridian-selection-history.png` |
| 3 Trade layout | `meridian-trade-layout-desktop-1280x800.png`, `meridian-trade-layout-desktop-1280x800-full.png` |
| 4 Book row click → ticket | `meridian-orderbook-highlight.png`, `meridian-orderbook-highlight-book.png` |
| 8 Payoff + distance | `meridian-payoff-line-ticket.png`, `meridian-payoff-line-sell-yes-ticket.png`, `meridian-payoff-line-buy-no-ticket.png`, `meridian-payoff-line-trade.png`, `meridian-payoff-distance-cards.png` |
| 15 Proof card / Recently settled | `meridian-settle-proof-card.png`, `meridian-settle-proof-admin-card.png`, `meridian-settle-proof-trade.png`, `meridian-recently-settled.png` |
| 17 Mobile | `meridian-trade-layout-mobile-390x844.png` |

There are no screenshots yet for 5–7, 9–14 or 16. The paused-book flow (13) has never been captured.

---

## Known limitations (not bugs: Pass = the behaviour described)

> - **DLV-069: a resting (limit) Sell No doesn't merge on fill.** You end up holding Yes + No ("Both sides held") until you sell both (5.8).
> - **Fills by others aren't in your History.** When another wallet fills your resting order, History doesn't show a fill row; you see it in the Phoenix balance and your later withdraw/cancel rows (11.7). TRACKER follow-up to DLV-088.
> - **Pyth off-hours → admin fallback.** Permissionless settle needs the first AAPL Pyth update **within 60 s after expiry** (D-025). Equity prices don't update outside US market hours. The sponsored accounts are also stale on devnet (RAILWAY_STAGING §0), and Hermes needs an API key. So a market that expires off-hours (or without a usable Hermes post) settles by **`admin_settle`** after the 5-min admin delay, at the last published mainnet Pyth price as read at about expiry + 330 s (not the price at expiry). The proof card then says `admin fallback` (15.2).
> - **Short window at expiry.** The pause lands seconds after expiry (box) or by the next automation tick, not in the same instant. Cancel resting orders before expiry if you don't want them exposed (13.9). The app has no "Paused" badge.
> - **Market orders are fill-or-kill.** If the book can't fill your whole size within the price limit, nothing trades (5.9). That's on purpose.

## Related

[`STAGING_TEST_PLAN.md`](STAGING_TEST_PLAN.md) (full devnet plan with operator steps and invariant checks) · [`TEST_RESULTS.md`](TEST_RESULTS.md) · [`SIM_LIFECYCLE.md`](SIM_LIFECYCLE.md) · [`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) · [`../ops/README.md`](../ops/README.md) (pause at expiry, operator tools)
