# Meridian

Meridian is a non-custodial Solana dApp for binary Yes/No stock outcome markets on MAG7 equities (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). Users mint Yes/No outcome token pairs against USDC collateral, trade them on a Phoenix CLOB book per strike, and settle to a $1 USDC binary payout using Pyth equity closes (~4:00 PM ET, same-day / 0DTE).

## Stack (locked)

| Layer | Choice |
| --- | --- |
| Chain / programs | Solana + Anchor (Rust) |
| Order matching | **Phoenix CLOB** — integrate existing Phoenix markets; do **not** build a custom matching engine |
| Oracle | Pyth equity price feeds (close / settle) |
| Collateral | USDC (SPL) |
| Frontend (parallel) | Next.js / TypeScript |
| Automation | Node / TypeScript (strike creation, settle retries) |
| Source of truth | Gauntlet Labs GitLab — `https://labs.gauntletai.com/debudash/peak6-meridian` (private) |

## Docs in this slice

This MR / branch is the **on-chain schema slice** (accounts, PDAs, instruction flows, events, units). UI work proceeds in parallel.

| Doc | Purpose |
| --- | --- |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | **Primary schema** — account layouts, Phoenix linkage, Pyth refs, units, instructions, events, invariants |
| [`docs/accounts.md`](docs/accounts.md) | Expanded per-account field specs |
| [`docs/flows.md`](docs/flows.md) | Mermaid sequence diagrams (mint / trade-on-Phoenix / settle / redeem) |
| [`docs/units.md`](docs/units.md) | Fixed-point scales and Pyth conversion rules |
| [`programs/meridian/README.md`](programs/meridian/README.md) | Anchor program module map for scaffolding |

## Phoenix (integrate, do not invent)

Each `StrikeMarket` wires to a Phoenix market account. Default wiring:

- **Base mint** = Meridian Yes outcome mint
- **Quote mint** = collateral (USDC)
- Frontend maps Buy/Sell Yes/No onto the single Yes/USDC book

Seats / trader accounts follow Phoenix conventions; Meridian does not own matching logic.

## Invariants (summary)

- Vault collateral = `$1 ×` pairs minted (protocol fees accounted separately if enabled)
- Yes supply == No supply == pairs outstanding until settle/redeem
- After settle: winning side redeems 1:1 for USDC; losing side burns worthless
- Settlement outcome is immutable once written (admin override only after configured delay)

## License / visibility

Private Gauntlet / Peak6 platinum deliverable. Do not publish externally without Gauntlet Labs approval.
