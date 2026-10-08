# scripts/localnet

## today-markets.cjs (DLV-118)

Creates **today's 0DTE MAG7 markets** (SPEC §1/§3.3: expiry = the effective trading day's 16:00 America/New_York close,
DST-aware) on a **local** validator, each with a mock Pyth feed, a Phoenix V1 book (Seat Manager authority) and a maker
5-level post-only ladder. Additive and idempotent: never edits existing markets, never touches the SimClock.

```bash
(cd apps/automation && npm run build)          # dist/marketDay.js = the same expiry rule the worker uses
RPC=http://127.0.0.1:8899 MERIDIAN_IDL=/path/to/localnet-test/target/idl/meridian.json \
  node scripts/localnet/today-markets.cjs
```

| Env | Default | Meaning |
| --- | --- | --- |
| `MERIDIAN_IDL` | `target/idl/meridian.json` | localnet-test IDL |
| `RPC` | `http://127.0.0.1:8899` | must be 127.0.0.1 / localhost (refuses otherwise) |
| `AUTH` | `~/.config/solana/id.json` | Config authority (create_strike_market) |
| `MAKER` | `/workspace/meridian-localnet-maker.json` | maker keypair |
| `SYMBOLS` | MAG7 | comma list |
| `REF_PRICES` | built-in mock refs | `AAPL=227.3,MSFT=410` — ATM strike rounds to $5 (≥ $100) or $1 |
| `STATE_OUT` | `/workspace/meridian-localnet-today-<dateKey>.json` | addresses written here (feed keypairs next to it, 0600) |
| `DRY_RUN=1` | off | plan only |
| `ALLOW_NON_TRADING_DAY=1` | off | localnet only: allow a weekend / holiday SimClock date |

Clock: SimClock PDA (`["sim_clock"]`) if enabled, else chain time — read only. At/after that day's close the script
**refuses (exit 3)** and never rolls to tomorrow; for D-017 anytime testing move the SimClock into a session first on a
validator where that's allowed. Requires the localnet-test build of the program (mock Pyth, SimClock) — never beyond localnet.
