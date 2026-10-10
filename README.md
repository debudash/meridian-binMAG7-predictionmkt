# Meridian

Yes / No contracts on where a MAG7 stock (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA) closes today, on Solana. Every Yes + No pair is backed by exactly $1 USDC held by the program, trades on an open order book, and settles from a public price feed that anyone can check.

- **Live demo (Solana devnet, test money):** https://web-production-77fbb.up.railway.app (Phantom on devnet)
- **Demo video:** link added at submission ([script](docs/DEMO_SCRIPT.md))
- **Reviewers, start here:** [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md), every line of the [Peak6 brief](docs/PEAK6_PRD.md) with its status and evidence

## The problem

A simple view like "Apple closes above $340 today" is hard to act on fairly:

- **You have to trust a middleman.** A broker or bookmaker holds your money and decides who won. If it is wrong, slow or insolvent, you find out too late.
- **You can't check the outcome.** The settlement price and the moment it was taken are whatever the operator says.
- **The tools are too complex for a yes/no view.** Options bring greeks, margin and expiry mechanics to what is really one question.

## The solution, and what it gives you

| Benefit | How Meridian delivers it |
| --- | --- |
| **Your winnings are always there** | Every Yes + No pair is minted against exactly $1 USDC in a program vault. Winners redeem $1 per contract; no one can spend the collateral. |
| **One clear question, a known risk** | "Will AAPL close at or above $340 today?" You pay a price between $0 and $1; the most you can lose is what you paid, the most you get is $1. The ticket says it in plain words before you buy. |
| **Fair, visible prices** | Trading runs on Phoenix, an open on-chain order book. You see every bid and ask. |
| **An outcome anyone can verify** | At 16:00 ET the market settles from Pyth's signed price, the first update at or after the close. Anyone can submit the settlement, and every market page shows a settlement proof with a link to the transaction. |
| **It runs itself** | Markets are created before the open, books pause at the close, settlement lands minutes later, and the system checks itself at 08:30 and 16:30 ET on a public Status page. |

## How it works

1. **Before 08:00 ET:** seven markets are created, one per stock, with the strike at the previous day's close (D-026).
2. **Until 16:00 ET:** you buy Yes or No on that market's order book, from your own wallet. (Books are not yet held closed until the 09:30 open, DLV-121.)
3. **16:00 ET:** the books pause and the market settles from Pyth: Yes wins if the close is at or above the strike.
4. **After settlement:** winners redeem $1 per contract; the losing side is worth nothing.

| Part | Role |
| --- | --- |
| Program (`programs/meridian`, Anchor) | Vault, mint and merge pairs, settle, redeem |
| Phoenix (existing exchange) | Order matching, one Yes/USDC book per market |
| Pyth (existing oracle) | Signed closing price |
| Web app (`apps/web`, Next.js) | Markets, trade ticket, portfolio, history, status |
| Worker (`apps/automation`, Node) | Creates markets, pauses books, settles, runs the daily checks |

More detail and diagrams: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Key decisions and trade-offs

| Decision | Why it helps the user | What it costs |
| --- | --- | --- |
| **One order book per market; "No" is built from mint and merge, not listed** (D-004, D-018) | No always costs 1 − Yes, so the two prices never disagree, and all the liquidity sits in one book. | A resting limit Sell No does not merge into USDC on its own yet (DLV-069). The No side is only as deep as the Yes side. |
| **Integrate Phoenix rather than build matching** (D-002) | A proven exchange, and far less code that can lose money. | Meridian inherits Phoenix's model; pausing books needs Phoenix's seat-manager role, which must be locked down before mainnet (DLV-105). |
| **Market orders fill completely or not at all** (D-024) | You are never left half-filled, for example holding both sides after a partial Buy No. Found by an end-to-end test (DLV-070). | No partial fills at market; use a limit order for that. |
| **Settle on the first Pyth update after the close; anyone can submit it** (D-025) | No one can pick a favourable price, and settlement doesn't depend on one operator. | Needs Pyth to publish within 60 s of the close. The fallback is an operator price with a logged source, and the program rejects an outcome that doesn't match price vs strike (D-018, D-027). |
| **Same-day markets, strike at the previous close** (D-026) | One at-the-money question per stock per day, ready before the open. | A strike can't change once the market exists. NYSE early-close days are refused for now. |
| **Read-only self-checks, shown on a page** (D-029, D-030) | Problems surface within 30 minutes on the Status page; the report is written by code from on-chain data. | It reports but doesn't page anyone, and it can't fix anything by itself. |

All decisions with dates and owners: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## What works today, and what doesn't yet

**Working on Solana devnet.** The program was deployed on 2026-10-08. On Friday 2026-10-09 seven MAG7 markets traded from a Phantom wallet, all seven books paused at 16:00 ET, and **all seven settled from Pyth automatically**, with no manual price ([`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md) §8). A winning position was redeemed for $1 per contract the same afternoon.

**Not done yet:**

- **Mainnet.** It needs an external security audit, a production market maker, and the seat-manager lockdown (DLV-105, DLV-112). Devnet uses test SOL and test USDC only.
- **Worker-created order books.** The worker creates markets, but their Phoenix books still come from an ops script (DLV-122).
- **A price chart** on the trade page (planned; not in the spec, D-031). A resting limit Sell No does not auto-merge (DLV-069).

Full status per requirement: [`docs/PRD_TRACE.md`](docs/PRD_TRACE.md).

## Try it

- **Live on devnet:** open the demo URL above with Phantom set to devnet.
- **Locally, any day:** a full copy (validator, Phoenix, 7 markets, web app) runs in Docker with a simulated clock, so markets close in minutes:

  ```bash
  docker compose -f docker/compose.localnet.yml up --build
  # wait for "[meridian-local] ready", then open http://127.0.0.1:3000
  ```

  Settle and redeem steps: [`docker/README.md`](docker/README.md). Manual setup and devnet deployment: [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Tests** (in the Docker toolchain; stop the local instance first):

  ```bash
  docker compose -f docker/compose.localnet.yml run --rm local bash -lc "anchor test -- --features localnet-test"
  docker compose -f docker/compose.localnet.yml run --rm local bash -lc "npm test --prefix apps/automation && npm test --prefix apps/web"
  ```

  Results and how each core path was tested: [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md).

## Documentation

| Deliverable | Where |
| --- | --- |
| Technical documentation | [`SPEC`](docs/SPEC.md) · [`ARCHITECTURE`](docs/ARCHITECTURE.md) · [`SCHEMA`](docs/SCHEMA.md) · [`DECISIONS`](docs/DECISIONS.md) · [`RED_TEAM`](docs/RED_TEAM.md) · [`ui/`](docs/ui/README.md) |
| Deployment guide | [`DEPLOY`](docs/DEPLOY.md) · [`docker/README`](docker/README.md) · [pauser rotation runbook](docs/runbooks/PAUSER_ROTATION.md) |
| Test results | [`TEST_RESULTS`](docs/TEST_RESULTS.md) · [`TEST_MATRIX`](docs/TEST_MATRIX.md) |
| Demo video | Link added at submission · [`DEMO_SCRIPT`](docs/DEMO_SCRIPT.md) |
| AI usage log | [`AI_USAGE`](docs/AI_USAGE.md) · full log [`internal/AI_LOG`](docs/internal/AI_LOG.md) |

## Repository map

| Path | Contents |
| --- | --- |
| `programs/meridian` | Anchor program ([README](programs/meridian/README.md)) |
| `apps/web` | Next.js app ([README](apps/web/README.md)) |
| `apps/automation` | Worker ([README](apps/automation/README.md)) |
| `ops/` | Devnet operator scripts ([README](ops/README.md)) |
| `docker/` | Toolchain image and local instance ([README](docker/README.md)) |
| `scripts/`, `tests/`, `idl/` | Build asserts and seeding, Anchor suites, program IDLs |
| `docs/` | The documents above; `docs/internal/` holds the tracker and the raw AI log |

Source of truth: Gauntlet Labs GitLab, `debudash/peak6-meridian` (private). Do not publish without Gauntlet Labs approval.
