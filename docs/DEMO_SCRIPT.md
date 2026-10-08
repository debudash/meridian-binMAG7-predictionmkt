# Demo script (demo video)

Script for the PRD demo video (DLV-038). Two ways to record it:

- **Path A — local Docker instance, any time.** Full lifecycle on a local validator with simulated time (D-017). Works any day, any hour.
- **Path B — devnet staging day.** The same flow on Railway staging against Solana devnet, on a trading day. Needs the program and markets on devnet (DLV-077).

Target length: 6–8 minutes. Keep one browser window and one terminal on screen.

## Before recording

| Path A | Path B |
| --- | --- |
| `docker compose -f docker/compose.localnet.yml up --build`, then open http://127.0.0.1:3000 ([`docker/README.md`](../docker/README.md)) | Program deployed and bootstrapped ([`DEPLOY.md`](DEPLOY.md) §4–§5); today's markets created by 08:00 ET on the prior close (§6.1); operator prices set if Hermes is not entitled (§6.2) |
| Connect the **Localnet Dev Wallet** (no extension needed) | Phantom on **Devnet** with SOL and test mUSDC; a second wallet for the counterparty |
| Wait for `[meridian-local] ready`: the seed creates the 7 MAG7 markets with books (same-day before 16:00 ET, otherwise "anytime" markets expiring in 120 min) | At least one market with a Phoenix book |

## Scenes

| # | Time | Show | Say |
| --- | --- | --- | --- |
| 1 | 0:00 | Landing page | "Meridian: non-custodial Yes/No contracts on whether a MAG7 stock closes at or above a strike today. Each pair is backed by exactly $1 USDC; the winning side pays $1." |
| 2 | 0:40 | [`ARCHITECTURE.md`](ARCHITECTURE.md) component diagram | "An Anchor program holds collateral and mints pairs. Phoenix, an existing order book, does the matching. Pyth supplies the close. A Node worker creates markets, pauses books at the close and settles." |
| 3 | 1:30 | `/markets`: cards, table, ladder; the `NN% implied Yes` labels and Buy Yes / Buy No prices | "Seven stocks, created by 8:00 AM ET with strikes at the previous close, all expiring at today's 16:00 ET close. Buttons show executable prices; the mid is shown only as an implied probability." |
| 4 | 2:15 | Trade page: order book, ticket, payoff line, distance to strike | "Four intents on one Yes/USDC book. The ticket says in plain words what you pay and what you get at the close." |
| 5 | 2:45 | **Buy Yes · Market · 5** → confirmed toast; Position shows Yes 5 | "A market order fills fully or not at all." |
| 6 | 3:15 | **Buy No · Market · 5** on another market → one transaction (mint + sell the Yes) | "Buy No mints a $1 pair and sells the Yes leg in the same transaction." |
| 7 | 3:45 | **Limit** order resting in the book; Open orders; Cancel | "Limit orders rest on Phoenix; cancel and withdraw are in the app." |
| 8 | 4:15 | Portfolio and History (CSV) | "Positions, Phoenix balances and history are read from the chain." |
| 9 | 4:45 | **Close and settle.** Path A: after the markets expire, run `docker compose -f docker/compose.localnet.yml exec local node docker/localnet/settle.cjs` (optionally `AAPL=230 …` to choose closes); it posts a mock Pyth price and calls the permissionless `settle`. Path B: after 16:00 ET, show the worker log line for the pause and the settle | "At the close the book is paused, so nobody trades on a known price. Settlement reads the first Pyth price at or after the close." Path B while DLV-106 is open: "On devnet our Hermes key is not yet entitled to equity prices, so we settle with an operator-sourced close price whose source is logged; the oracle path is built and tested." |
| 10 | 5:45 | Market page **Settlement proof** card; `/markets` **Recently settled** | "Price vs strike, confidence, slot and the settle transaction, all from on-chain data." |
| 11 | 6:15 | Portfolio → **Redeem**; wallet USDC rises by exactly 5.00 | "The winner gets $1 per contract. The loser gets 0." |
| 12 | 6:45 | Terminal: `yarn test` summary or [`TEST_RESULTS.md`](TEST_RESULTS.md); [`PRD_TRACE.md`](PRD_TRACE.md) | "Every core path was written test-first. Here is where each PRD line stands." |
| 13 | 7:15 | [`AI_USAGE.md`](AI_USAGE.md) | "Built by AI agents under human decisions; this is how the work was split and checked." |

## Points to state plainly

- Non-custodial: collateral sits in a program vault; prod builds have no admin drain.
- $1 invariant: vault = pairs × $1 and Yes supply = No supply, checked after every step in the tests.
- Phoenix is integrated, not rebuilt.
- Path A uses simulated time and a mock price feed that exist only in the `localnet-test` build; prod builds cannot contain them.
- Known gaps (see [`PRD_TRACE.md`](PRD_TRACE.md)): settle-by-16:05 on the operator path (DLV-123), devnet lifecycle not yet run (DLV-077).

## Do not

- Use mainnet or real funds.
- Make regulatory or compliance claims.
- Show secret keys, `.env` files or the `/api/localnet-dev-wallet` response.
