# Demo script (demo video)

Script for the PRD demo video (DLV-038). **Status:** a cut of about 4 minutes exists (screen recordings of the local stack and of devnet); the narration is not recorded yet, and the link is added to the README at submission.

The video uses two sources:

- **Path A — local Docker instance, any time.** Full lifecycle on a local validator with a simulated clock, mock prices and a dev wallet (D-017). Same program and app code as devnet. Works any day, any hour.
- **Path B — devnet, the live day of Friday 2026-10-09.** https://web-production-77fbb.up.railway.app against Solana devnet: the deployed program, 7 markets with Phoenix books, trades from Phantom, all 7 paused and settled by the worker through the Pyth pull oracle ([`TEST_RESULTS.md`](TEST_RESULTS.md) §8).

Target length: about 4 minutes. Test money everywhere (local test USDC, devnet mUSDC).

## Before recording

| Path A | Path B |
| --- | --- |
| `docker compose -f docker/compose.localnet.yml up --build` (add `RESET=1` for a fresh chain), then open http://127.0.0.1:3000 ([`docker/README.md`](../docker/README.md)) | Program deployed and bootstrapped ([`DEPLOY.md`](DEPLOY.md) §4–§5); the 2026-10-09 markets are settled and stay on devnet with their settlement proofs |
| The **Localnet Dev Wallet** connects without an extension | Phantom on **Devnet** with SOL and test mUSDC |
| Wait for `[meridian-local] ready`: the seed creates the 7 MAG7 markets with books (same-day before 16:00 ET, otherwise "anytime" markets expiring after `ANYTIME_EXPIRY_MINUTES`, default 120) | The Status page `/status` shows the worker's create and settle checks |

## Scenes

| # | Show | Say (narration pending) |
| --- | --- | --- |
| 1 | Landing page | **The problem.** Betting on where a stock closes usually means trusting a broker who holds the money and decides who won. Meridian offers Yes/No contracts on the daily close of the MAG7 stocks, each pair backed by exactly $1 USDC and settled by a public price feed. |
| 2 | [`ARCHITECTURE.md`](ARCHITECTURE.md) component diagram | **How it works.** An Anchor program holds the collateral and mints Yes+No pairs. Phoenix, an existing order book, does the matching. Pyth supplies the close. A Node worker creates markets, pauses books at the close and settles. |
| 3 | Title card | **What is real and what is simulated.** Real: devnet on 2026-10-09 — the deployed program, Phoenix books, live Pyth equity prices, Phantom trades, 7 markets paused and settled by the worker, the Status page. Simulated: the local copy — same code, simulated clock, mock prices, dev wallet. Test money everywhere. |
| 4 | Path A `/markets` | **Markets.** Seven stocks, each with a strike and a close; buttons show executable prices, the mid only as `NN% implied Yes`. |
| 5 | Path A: **Buy Yes · Market** → confirmed toast; Position shows Yes | **Buy Yes** is a bid on the Yes/USDC book. |
| 6 | Path A: **Buy No · Market** → one transaction (mint + sell the Yes) | **Buy No** mints a $1 pair and sells the Yes leg in the same transaction. |
| 7 | Path A: order book and ticket | **The decision: one order book per market, No built from mint / merge.** For the user: No always costs 1 − Yes, all liquidity sits in one book, and market orders are fill-or-kill, so an order is never half-filled. Trade-offs: a resting limit Sell No does not merge on fill (DLV-069), No depth equals Yes depth, and Buy No briefly needs the full $1. |
| 8 | [`TEST_RESULTS.md`](TEST_RESULTS.md) | **How it was tested.** Tests of the $1 vault invariant, 109 program tests. An end-to-end test caught a half-filled Buy No (DLV-070), which led to fill-or-kill market orders (D-024). Settlement was rehearsed on a 5-minute devnet market before the live close. |
| 9 | Path A terminal: `docker compose -f docker/compose.localnet.yml exec local node docker/localnet/settle.cjs` (optionally `GOOGL=165 TSLA=245 …` to choose closes); then Portfolio → **Redeem** | **Local settle and redeem.** After expiry the script posts a mock Pyth price and calls the permissionless `settle`; the winner redeems $1 per contract, the loser gets 0. |
| 10 | Path B `/markets` **Recently settled** | **Devnet, 2026-10-09.** The 7 live markets, settled after the 16:00 ET close. |
| 11 | Path B NVDA market page **Settlement proof** + the settle transaction on Solana Explorer | NVDA closed at $229.34, below the $230 strike, so No won. Price, confidence, slot and the settle transaction, all from on-chain data. |
| 12 | Path B footer **Status** (`/status`) | The worker checks itself from chain data at 08:30 ET (30 minutes after the 08:00 create deadline) and 16:30 ET (30 minutes after the close): `✅ Settle check 2026-10-09: 7/7 settled (4 YES, 3 NO).` Code writes these facts. |
| 13 | [`PRD_TRACE.md`](PRD_TRACE.md) | **What works today and what is next:** a price chart, a production market maker, a security audit, mainnet. |

## Points to state plainly

- Non-custodial: collateral sits in a program vault; prod builds have no admin drain.
- $1 invariant: vault = pairs × $1 and Yes supply = No supply, checked after every step in the tests.
- Phoenix is integrated, not rebuilt.
- Path A uses a simulated clock and a mock price feed that exist only in the `localnet-test` build; prod builds cannot contain them.
- Known gaps (see [`PRD_TRACE.md`](PRD_TRACE.md)): the worker does not create Phoenix books (DLV-122); books are not gated to 09:30 (DLV-121).

## Do not

- Use mainnet or real funds.
- Make regulatory or compliance claims.
- Show secret keys, `.env` files or the `/api/localnet-dev-wallet` response.
