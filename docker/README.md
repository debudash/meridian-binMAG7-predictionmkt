# Docker: toolchain + local test instance

One image (`toolchain.Dockerfile`) holds everything the repo needs on Linux: Rust 1.85, Solana/Agave CLI 4.3.0,
Anchor 0.31.1, Node 22, socat. It serves two jobs.

| Job | Command (from the repo root) |
| --- | --- |
| **Local test instance** (validator + Phoenix + 7 MAG7 markets + web app) | `docker compose -f docker/compose.localnet.yml up --build` |
| **Run a suite / build** in the same toolchain | `docker compose -f docker/compose.localnet.yml run --rm local bash -lc "<command>"` |

Windows needs Docker Desktop (or Rancher Desktop) with the WSL 2 engine. No Rust/Solana install on Windows.

## Local test instance

```bash
docker compose -f docker/compose.localnet.yml up --build
```

The first run builds the image and the program (`anchor build -- --features localnet-test`) and dumps the Phoenix V1 and
Seat Manager programs from mainnet (read-only). That takes ~15 min. Later starts take about a minute.

Watch for `[meridian-local] ready`. Then open **http://127.0.0.1:3000**, click the wallet button and choose
**Localnet Dev Wallet**. Use `127.0.0.1` rather than `localhost`: if another app on the PC listens on `[::]:3000`, `localhost` reaches it instead. The wallet holds 20 SOL and 100,000 test USDC and signs without a browser extension.

What `docker/localnet/start.sh` does, in order:

1. **Keys.** Authority, maker and dev wallet are created once in the `data` volume (`/data/keys`). They never touch the repo.
2. **Program.** The `localnet-test` build is loaded at the real program id with `--bpf-program`, so no program keypair is needed.
3. **Phoenix.** Phoenix V1 `PhoeNiX…` and Seat Manager `PSMxQb…` are the same binaries devnet and mainnet run.
4. **Validator.** `solana-test-validator` runs on :8899 (WebSocket :8900). The ledger persists in the `data` volume.
5. **Seed** (`docker/localnet/seed.cjs`). Test USDC, `initialize_config` (fees 0, staleness 150 slots, conf 500 bps,
   admin_settle delay 0), then the 7 MAG7 markets through `scripts/localnet/today-markets.cjs`. Each market gets a
   mock Pyth feed, a Phoenix Yes/USDC book under the Seat Manager, and a maker ladder.
   - **Same-day (default during a trading day before 16:00 ET).** Markets expire at today's 16:00 ET close, as the
     SPEC requires.
   - **Anytime (after the close, weekends, holidays).** D-017 anytime play: markets expire at now + 120 min.
     `ANYTIME_EXPIRY_MINUTES=30` makes the wait shorter.
6. **Web.** `next dev` runs on 127.0.0.1:3000 inside the container.

### Settle and redeem

Once markets expire, run:

```bash
docker compose -f docker/compose.localnet.yml exec local node docker/localnet/settle.cjs              # at the reference prices
docker compose -f docker/compose.localnet.yml exec local node docker/localnet/settle.cjs AAPL=230 TSLA=240  # choose closes
```

This posts a fresh mock Pyth price and calls the permissionless `settle`. The D-005 gates apply, and Yes wins iff
price ≥ strike. Afterwards **Portfolio → Redeem** pays $1 USDC per winning token.

### Options

| Env (prefix the `up` command) | Effect |
| --- | --- |
| `RESET=1` | Wipe the ledger and state (keys are kept) and seed from scratch |
| `REBUILD=1` | Rebuild the program (after a change under `programs/`) |
| `SEED_MODE=anytime` / `today` | Force a seed mode |
| `ANYTIME_EXPIRY_MINUTES=30` | Expiry for anytime markets (5–10080) |

PowerShell: `$env:RESET=1; docker compose -f docker/compose.localnet.yml up`.

To stop, use `docker compose -f docker/compose.localnet.yml down`. Add `-v` to also delete the volumes (ledger, keys,
node_modules, build cache).

### Why the web port goes through a relay

The Localnet Dev Wallet has security gates (DLV-080 / DLV-081). It only signs when the dev server is bound to loopback
and the request comes from a loopback peer. Docker port mapping would make every request come from the Docker gateway,
so the gates would correctly refuse.

Inside the container, `next dev` binds 127.0.0.1:3000 and `socat` relays :3001 to it. Docker publishes :3001 on
**Windows 127.0.0.1:3000 only**, so nothing off this PC can reach the dev wallet.

Do not change the port mappings to `0.0.0.0`.

## Running the suites in Docker

```bash
# program suite (own validator inside `anchor test`; stop the local instance first, it also uses :8899)
docker compose -f docker/compose.localnet.yml run --rm local bash -lc "anchor test -- --features localnet-test"
# prod build + no-fixture assert + prod settle on the prod .so in LiteSVM
docker compose -f docker/compose.localnet.yml run --rm local bash -lc "npm run build:prod && npm run build:prod-so && npm run test:prod-settle"
# automation + web unit suites
docker compose -f docker/compose.localnet.yml run --rm local bash -lc "npm test --prefix apps/automation && npm test --prefix apps/web"
```

`anchor build` without features overwrites `target/deploy/meridian.so` with the prod build. Start the local instance
with `REBUILD=1` afterwards.

Notes from the 2026-10-08 runs (results: [`docs/TEST_RESULTS.md`](../docs/TEST_RESULTS.md)):

- **Expected Anchor result:** 87 passing, 23 pending. The 23 pending are `tests/prod/settle_pull_oracle.ts`, which skips
  itself when `target/prod/meridian.so` is absent; the second command above runs those 22 cases.
- **Slow Windows bind mount.** With the test ledger on the Windows bind mount, 7 Anchor tests timed out. Keep the ledger
  on a Linux volume, for example by adding `-v anchor-ledger:/repo/.anchor` after `run --rm`. Three web `siteMeta`
  tests may also need `npm test --prefix apps/web -- --testTimeout=60000`.
- The image sets `NODE_OPTIONS=--no-experimental-strip-types` so Node 22 leaves `.ts` files to ts-node.
- `.gitlab-ci.yml` pins the same Agave 4.3.0; the earlier 2.1.0 pin could not build the edition-2024 crates now in `Cargo.lock`. This image is
  the reference toolchain.
