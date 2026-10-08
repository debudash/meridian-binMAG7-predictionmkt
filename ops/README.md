# ops/ — devnet staging operator scripts

Committed copies of the former box-only staging scripts (review dd46769). They hold **no keys and no box paths**:
every keypair path, RPC, program id and secret comes from the environment or an untracked env file
(`ops/staging.env`, see `staging.env.example`).

| File | What |
| --- | --- |
| `run-staging.sh` | Full pipeline: wait for payer SOL → prod build of `origin/main` → deploy/upgrade → deployed-binary fixture assert → bootstrap → **pause watcher** → e2e → START-triggered 20-min AAPL ≥ 300 market → **pause at expiry** → **Pyth pull settle (Hermes)** → `admin_settle` fallback → redeem. `DRY_RUN=1` prints the plan, zero transactions. |
| `devnet-bootstrap.cjs` | Idempotent bootstrap (mUSDC, config, strike markets, Phoenix books + maker ladder, wallets, settler, **pauser** + seat-manager **handoff**). `DRY_RUN=1` offline plan. |
| `settle-test.cjs` | Short-market `mint` / `settle` / `redeem` / `status`. `settle` = pull settle via `apps/automation` `ops-cli pull-settle` (settler key, `PYTH_HERMES_API_KEY`), then sponsored-account settle, then `admin_settle` (`ADMIN_PRICE_E6`). |
| `pyth-read.py` | **Informational only**: last published price of the Mag-7 shard-0 accounts (weeks stale). Age guard (`--max-age-secs`, default 900): stale feeds print `STALE`, are left out of the JSON and exit 2. **Never a settle price** (Reviewers mr72-73 M3). |
| `lib/admin-price.cjs` | `settle-test.cjs` refuses `ADMIN_PRICE_E6` without `ADMIN_PRICE_SOURCE` (unit-tested). |
| `lib/psm.cjs` | Phoenix Seat Manager ix builders for the .cjs scripts; byte parity with `apps/automation/src/phoenix/seatManager.ts` is unit-tested. |
| `staging.e2e.test.ts` | Opt-in web order-path e2e (`STAGING_E2E=1`), copied into a prepared `apps/web` by `run-staging.sh`. |

## Keys (never committed, chmod 600)

| Key | Role | Where it may live |
| --- | --- | --- |
| `upgrade-authority.json` | program upgrade authority, payer, Phoenix book creator, **initial** seat-manager authority | operator box only. **Never Railway.** |
| `keeper.json` | Meridian config authority (create, `admin_settle`) | box + Railway `AUTOMATION_KEYPAIR` |
| `settler.json` | permissionless `settle` signer/payer (M3) | box + Railway `SETTLER_KEYPAIR` |
| `pauser.json` | Phoenix **seat-manager authority** after the handoff: pause/resume books, evict seats (funds return to traders), fee recipient. Can't move user funds | box + Railway `PHOENIX_PAUSER_KEYPAIR` (automation service only) |

## Pausing Phoenix books at expiry

Mechanism (verified against `phoenix-seat-manager-v1` 31ad32a + `phoenix-v1` source, and on a localnet validator in
`apps/automation/test/phoenix-pause.localnet.test.ts`):

1. Bootstrap creates each book with the upgrade key, activates it, names the Seat Manager PDA as Phoenix successor and
   calls PSM `ClaimMarketAuthority` (the PDA becomes the Phoenix market authority; the **payer** becomes the
   seat-manager authority).
2. Right after that, **handoff**: PSM `NameSuccessor` (6, signed by the payer) + `ClaimSeatManagerAuthority`
   (7, signed by the pauser) in one transaction. Re-run safe: books already on the pauser are skipped; older books
   still on the payer are handed off on the next bootstrap run (or `ops-cli handoff --state …`).
3. At `expiry_ts` (minus `PHOENIX_PAUSE_LEAD_SECS`, default 0) the pauser sends PSM `ChangeMarketStatus` (8) with
   `Paused` (3): no new orders or crosses; **cancel and withdraw still work**. The automation worker does this every
   tick plus an exact-time timer; the box runs `ops-cli pause-watch` as a backstop and `pause-once` for the 20-min
   market. Overdue/failed pauses and books whose seat-manager authority isn't the pauser log `[pause] ALERT …`.
   Note: PSM ix 8 needs the seat-manager PDA **writable** (Phoenix's CPI marks its authority writable), although the
   PSM IDL lists it read-only.

Manual tools (from `apps/automation` after `npm run build`; keys passed as file paths):

```
SOLANA_RPC_URL=… node dist/ops-cli.js pause-status --state $STATE   # read-only: no key needed
SOLANA_RPC_URL=… PHOENIX_PAUSER_KEYPAIR=… SEAT_MANAGER_AUTHORITY_KEYPAIR=$KEYS_DIR/upgrade-authority.json DRY_RUN=1 node dist/ops-cli.js handoff --state $STATE
```

## admin_settle fallback price (Reviewers mr72-73 M3)

`run-staging.sh` never settles from a stale account. When the Pyth pull settle hasn't landed by expiry + 330 s:

1. `ops-cli admin-price --market <20-min market>` (read-only; Hermes key from env) takes the **Hermes price at expiry**
   if it is the market's feed, `|publish_time − expiry| ≤ ADMIN_PRICE_MAX_SKEW_SECS` (600) and conf ≤ the config cap.
2. Otherwise it prints `ADMIN_PRICE_REFUSED reason=…`; the script logs `[settle] ALERT … REFUSED` and waits up to
   `OPERATOR_PRICE_WAIT_HOURS` (24) for `$ADMIN_PRICE_FILE` (default `$OPS_DIR/ADMIN_PRICE_20M`, gitignored):

   ```
   market=<20-min strike market pubkey>
   price_e6=<integer micro-USD, e.g. 254310000>
   source=<where it came from, e.g. Nasdaq official close 2026-10-09>
   ```

   The file is parsed (never sourced as shell), re-checked by `admin-price` (bound to that market, source required; a
   valid Hermes price still wins), logged with its source, and renamed `.consumed-…`.
3. `settle-test.cjs settle` gets `ADMIN_PRICE_E6` **and** `ADMIN_PRICE_SOURCE`; without a source it refuses.

Checked 2026-10-08: the current Hermes key returns 403 "Not entitled" for equity feeds, so until it has an equity grant
the operator price is the path that settles the AAPL market.

## Seat-manager handoff repair

After each bootstrap phase `run-staging.sh` runs `handoff_repair`: `ops-cli handoff --state $STATE` over **every** book in
the state (pre-!73 Friday books included; idempotent: on the pauser → ok, on the upgrade key → PSM 6 + 7, anything else →
`[pause] ALERT`), then `ops-cli pause-status --state $STATE --expect-pauser <pauser pubkey>` (no key) which prints
`N/M books have the pauser … as seat-manager authority` and exits 2 with `[pause] ALERT` lines otherwise. Retried 3×.
`DRY_RUN=1` runs the same path read-only once `$AUTO/dist` has it.

## Box watcher

The box runs a synced copy (`$OPS_DIR` = the staging ops dir with its own `staging.env`), not the git checkout, so a
`git pull` never changes a running pipeline. Update procedure: back up, copy `ops/` from the merged SHA atomically,
restart the watcher with the retired workspace token unset, run `DRY_RUN=1` until it exits 0.
