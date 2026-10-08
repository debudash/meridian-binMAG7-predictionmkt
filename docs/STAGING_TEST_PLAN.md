# Meridian devnet staging acceptance test plan (Phantom)

| Field | Value |
| --- | --- |
| **Owner** | Meridian Testers |
| **Tester** | Debu (manual, Phantom on devnet) |
| **App under test** | Railway staging web: https://web-production-77fbb.up.railway.app ([`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) §0) |
| **Cluster** | Solana **devnet** (`https://api.devnet.solana.com`) |
| **Program id** | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` (prod build, no `localnet-test` features; [`DEPLOY.md`](DEPLOY.md) §3, `apps/web/src/lib/solana/config.ts` `DEFAULT_PROGRAM_ID`) |
| **Written against main tip** | `7219ac1` (`7219ac1425c7d4197c3830045eadc1fcc52db693`, Merge !73 `feat/phoenix-pause-ops`, on top of `578af22` = !72 web Lows). Earlier revisions: `0d856ed` (!65), `ea84698` (!66), `dd46769` (!68, re-checked against !67 / !69 / !70 / !71 while open). !73 changes what this plan cites at expiry and at settle: Phoenix books are **paused at expiry** by a dedicated pauser through the Phoenix Seat Manager, the operator scripts are now **in git under `ops/`**, and the settle step runs the Pyth pull settle before `admin_settle`. !72 (web) adds the M5 lock to market-card Buy links and stops Portfolio from re-reading empty settled books; no step text changes. The program and IDL are unchanged since `0d856ed`. |
| **Revision** | **!73 pause at expiry + settle chain** (this revision): §0 pauser and settle-chain rows, 1.2d (pauser key + handoff), 1.7 / timing note (new READY line), §4 note on post-expiry runs, §7 intro / settle bullets / at-expiry box (replaces the "books stay tradeable" known limit), 7.3, **7.3b rewritten** (posting/crossing blocked, Cancel / Cancel all / Withdraw still work), **7.3c new** (book status = Paused), 7.5 / 7.6 (settle chain), §9 note for a Pyth settle, coverage gaps, known limits. Earlier: Reviewer fixes from the Meridian Reviewers' !63/!65 review (MR !65 notes, items 1–8): deployed-binary check (1.1b), explicit `devnet` cluster (1.2b, 2.1; M2 fixed by !69), 404 checks (2.3b, 2.4b), whole-contract caution (§3), sweep and atomicity checks (4.9–4.11), M1/M5 checks (3.11, 6.8; both fixed by !67), §11.1 offsets wording, Reviewer conditions that still hold in the known-limits table (M3 moved to a settle note in §0 / 1.2c / §7 after !70), and the staging script's 20-min market **with** a Phoenix book and a funded wallet B (1.5, 1.7, §7) |
| **Status** | Ready to run **once the prod `.so` is deployed to devnet and the staging markets are bootstrapped** (DLV-077 is In Progress, blocked on devnet SOL) |

Use this checklist once the program is on devnet. Each step has an **Action**, the **Expected result** on main @ `7219ac1`, and a **Pass / Fail** box. Steps that depend on a feature that is not on main are marked **pending feature: not on main @ 7219ac1**. Steps that need the operator (someone with the staging keys on the ops box) are marked **[operator]**.

**Not covered here:** deploying, Railway changes, local validators. This plan is read-and-click only for Debu (plus two read-only `curl -I` checks in §2). The operator steps are listed so you know what to ask for and when.

**"Per staging script"** means the operator pipeline under [`ops/`](../ops/README.md): `ops/run-staging.sh` + `ops/devnet-bootstrap.cjs` + `ops/settle-test.cjs` (+ `ops/pyth-read.py`, `ops/lib/psm.cjs`). Since !73 (DLV-098) these are **in git at `7219ac1`** with no keys or box paths (every path, RPC and secret comes from env / an untracked `ops/staging.env`). The box runs a **synced copy** of `ops/` from a merged SHA, not the git checkout (`ops/README.md` "Box watcher"), so ask the operator which SHA the box copy came from. Each step that relies on the pipeline keeps a **fallback** line for a run where it doesn't do it.

---

## 0. Staging facts used by this plan

Sources: [`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) §0, [`DEPLOY.md`](DEPLOY.md), program source under `programs/meridian/src/`.

| Item | Value | Source |
| --- | --- | --- |
| Collateral | Staging test mint **mUSDC** `GEBRsT3Nc3PaEio2qf3x4JUgFtPSYXr7bmVitMuzMBXq`, 6 decimals. Mint authority is a box-only admin key, so only the operator can mint it | RAILWAY_STAGING §0 |
| Config params | Fees **0 / 0 bps**, `settle_max_staleness_slots` 150, `settle_max_conf_ratio_bps` 200, **`admin_settle_delay_secs` 300** (staging only) | RAILWAY_STAGING §0 |
| Config authority / keeper | `CCt1MZ5GPYskDBjSDfknkamesGufsJFk2yFzXNvV5dst`. Only this key can `admin_settle`. It is a Railway secret / ops-box key, not in Phantom. It creates markets and runs `set_phoenix_market` and `admin_settle` (authority-only by design). It **doesn't** sign permissionless `settle`: that's the separate settler key (§7 note, Reviewers M3 fixed by !70) | RAILWAY_STAGING §0 and §2, `instructions/admin_settle.rs` (`has_one = authority`), `apps/automation/src/config.ts` (`resolveSettler`) |
| Phoenix | V1 `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` + Seat Manager. Yes/USDC books, tick $0.01, 1 lot = 1 contract, 0 bps. Any wallet can claim a seat (the app does it on your first order) | RAILWAY_STAGING §0, D-015 |
| Markets (planned) | AAPL ≥ 305, NVDA ≥ 210, TSLA ≥ 365, MSFT ≥ 495, all expiring **Fri 2026-10-09 16:00 ET (3:00 PM CT)**. Phoenix books on the first 1–3, depending on SOL | RAILWAY_STAGING §0 |
| Short settle-check market | **AAPL ≥ 300**. Per staging script it's created **on your START signal** (not at bootstrap), **with a Phoenix Yes/mUSDC book**: the maker mints 3,000 pairs and posts a 5-level ladder around fair 0.50 (asks 0.51 / 0.53 / 0.55 / 0.57 / 0.59, bids 0.49 / 0.47 / 0.45 / 0.43 / 0.41, sizes 100…500). Expiry = chain time at START + 20 min + 180 s setup, so ≥ 20 min of trading remain after the log line `SHORT MARKET READY`. **Fallback:** a run without the book behaves as in §7's fallback note | Per staging script (`run-staging.sh` header, `devnet-bootstrap.cjs` `SHORT_BOOK=1`, `SHORT_MIN=20`, `SHORT_SETUP_SECS=180`); RAILWAY_STAGING §0 |
| Wallet B (counterparty) | Per staging script: funded at bootstrap with **0.5 SOL** (devnet faucet airdrop; payer transfer only if the faucet refuses) + **1,000 mUSDC** (admin `mint_to`). It's either the box keypair `wallet-b.json` (import into Phantom) or, with `WALLET_B=<pubkey>`, your own second Phantom address. **Fallback:** ask the operator to fund it by hand | Per staging script (`devnet-bootstrap.cjs` step 1c, `WALLET_B_SOL` 0.5, `WALLET_B_USDC` 1000) |
| Web cluster | `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`, set **explicitly**, and never `custom` on staging. Reviewers **M2** is fixed on main by !69: a fixture-style label (`localnet` / `localhost` / `custom`) now enables fixture markets, the fixture book, fixture slugs and the demo portfolio **only with a loopback** `NEXT_PUBLIC_SOLANA_RPC_URL` (`isFixtureCluster(cluster, rpcUrl)`). `custom` is still wrong for staging: Explorer links become `?cluster=custom&customUrl=…` (`explorerClusterQuery`), the chip shows `custom`, and the Reviewers' condition stands until they re-review. The app has **no URL parameter** for the cluster. The label comes only from this env var (default `devnet`) and is baked in at build time | `apps/web/src/lib/solana/config.ts` (`getCluster`, `fixturesAllowed`), `lib/market/marketIdRoute.ts` (`FIXTURE_CLUSTERS`, `isFixtureCluster`, `LOOPBACK_RPC`), `apps/web/.env.railway.staging.example`; per staging script `pin_web_cluster` (`WEB_CLUSTER=devnet  # never custom`) |
| Settler key (M3) | Automation signs **and pays** for permissionless `settle` (sponsored-account settle, or Hermes post + `settle`) with `SETTLER_KEYPAIR`, a low-balance Railway secret (~0.05 devnet SOL) that must differ from the authority and is required on mainnet-beta. On-chain, `settle` accepts any signer (`programs/meridian/src/instructions/settle.rs`, `Settle.settler` is a bare `Signer`). Per staging script, the box key `settler.json` plays the same role for `ops/settle-test.cjs` and `ops-cli pull-settle` (missing file → keeper + `WARNING settler key … missing`) | `apps/automation/src/config.ts` (`resolveSettler`), `deploy/railway/automation.staging.env.example`, RAILWAY_STAGING §2, !70 |
| Phoenix pauser (!73) | A dedicated low-balance **pauser** key (`pauser.json` on the box, Railway secret **`PHOENIX_PAUSER_KEYPAIR`** on the automation service only). Right after each book is created and put under the Phoenix Seat Manager, bootstrap moves the book's **seat-manager authority** from the upgrade key to the pauser (PSM `NameSuccessor` 6 + `ClaimSeatManagerAuthority` 7 in one tx). At `expiry_ts` the pauser sends PSM `ChangeMarketStatus` (8) → **`Paused`** (Phoenix status 3): no new orders, posts or crosses; **cancel and withdraw still work**. Who pauses: the automation worker (every tick + an exact-time timer), and on the box `ops-cli pause-watch` (backstop) plus `pause-once` for the 20-min market. The pauser can't move user funds. It must differ from the authority and the settler (`resolvePauser` throws otherwise) and is required on mainnet-beta; unset off mainnet → worker warning `PHOENIX_PAUSER_KEYPAIR unset on … — Phoenix books will NOT be paused at expiry` | `apps/automation/src/config.ts` (`resolvePauser`), `apps/automation/src/worker.ts`, `apps/automation/src/phoenix/pauseAtExpiry.ts`, `apps/automation/src/phoenix/seatManager.ts`, `ops/devnet-bootstrap.cjs` (`handoffToPauser`), `ops/README.md` "Pausing Phoenix books at expiry", DEPLOY §4, RAILWAY_STAGING §2, TRACKER DLV-097 |
| Settle chain (!73) | **Box pipeline** (`ops/run-staging.sh` step 7 → `ops/settle-test.cjs settle`, from expiry + 90 s, retried every 30 s): (1) **Pyth pull settle** via `ops-cli pull-settle` when `PYTH_HERMES_API_KEY` is in the box env (inside it: the market's sponsored feed account first, then Hermes `/v2/updates/price/{expiry}` → Pyth receiver post → `settle`); (2) the legacy permissionless `settle` against the market's stored sponsored Pyth account; (3) from expiry + 330 s, **`admin_settle`** by the config authority at the last published AAPL Pyth price (`ops/pyth-read.py`). Steps 1–2 are signed and paid by the **settler**, step 3 by the **authority**. **Automation worker** (Friday markets, ≥ 16:00 ET only): sponsored account → Hermes post → `admin_settle` only after `ADMIN_SETTLE_AFTER_RETRIES` (20) failed tries **and** a fixed `ADMIN_SETTLE_PRICE_E6` + `ADMIN_SETTLE_OUTCOME_YES`. TRACKER DLV-085 records `PYTH_HERMES_API_KEY` as set on Railway `automation` (2026-10-07) | `ops/run-staging.sh`, `ops/settle-test.cjs`, `apps/automation/src/ops-cli.ts` (`pull-settle`), `apps/automation/src/solana/pullSettle.ts` (`settleWithPullOracle`), `apps/automation/src/modes/calendar.ts`, `apps/automation/src/config.ts`, D-025, TRACKER DLV-085 |
| Dev wallet | Off on staging (`/api/localnet-dev-wallet` → 404, checked in 2.4b). Phantom/Solflare only | RAILWAY_STAGING §0, `components/providers/AppProviders.tsx`, `app/api/localnet-dev-wallet/route.ts` |

Market question text on cards and the trade page is `Will <SYMBOL> close at or above $<strike>?` (`lib/indexer/mapStrikeMarket.ts`).

---

## 1. Preconditions

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 1.1 | Open `https://explorer.solana.com/address/9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6?cluster=devnet`. | Account exists, **Executable: Yes**, upgrade authority `2DTwL4KoEoGgThD6xRKtms26invuVGgh6sL8hbonkzpa` (staging key, RAILWAY_STAGING §0). If "Account does not exist", stop: the program isn't deployed yet (DLV-077). | [ ] Pass [ ] Fail |
| 1.1b | **[operator]** **Deployed-binary check (prod `.so` only).** On a machine with the Solana CLI and a checkout of the repo at the tested tip, dump the program that is actually on devnet and run the repo's fixture assert on it:<br>`solana program dump -u devnet 9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6 /tmp/m.so && bash scripts/assert-prod-no-fixtures.sh /tmp/m.so idl/meridian.prod.json`<br>Script: `scripts/assert-prod-no-fixtures.sh` (arg 1 = `.so`, arg 2 = prod IDL; the same script CI runs on the build in `.gitlab-ci.yml` `prod-build-no-fixtures` and `yarn build:prod` runs after `anchor build`). | Prints `assert-prod-no-fixtures: .so OK (/tmp/m.so)` and `assert-prod-no-fixtures: prod IDL OK (idl/meridian.prod.json)`, exit 0. The dump contains **no** fixture strings: none of `upsert_mock_pyth` / `UpsertMockPyth`, `test_drain_vault` / `TestDrainVault`, `sim_open_session`, `sim_close_session`, `init/set/warp/disable_sim_clock`, `sim_clock` / `SimClock` (case-insensitive `strings` grep). `FAIL — fixture strings found` means a `localnet-test` build is deployed: **blocker, stop the run**. Trailing zero padding in the dump doesn't matter (string grep). Per staging script, the pipeline runs this same check on the deployed program after every deploy and aborts bootstrap on failure (log line `deployed check: on-chain 9Rb7nx… passes assert-prod-no-fixtures (dump sha256 …)`). Ask for that line, or run the command yourself. | [ ] Pass [ ] Fail |
| 1.1c | **[operator]** (Optional negative) Simulate (don't send) a tx to `9Rb7nx…` whose data starts with the Anchor discriminator of `upsert_mock_pyth` or `test_drain_vault` (`sha256("global:<name>")[0..8]`). | Simulation fails with Anchor `InstructionFallbackNotFound` (error 101 / `0x65`): the prod program doesn't contain the fixture ixs. | [ ] Pass [ ] Fail |
| 1.2 | Open `https://web-production-77fbb.up.railway.app/api/health`. | HTTP 200. | [ ] Pass [ ] Fail |
| 1.2b | **[operator]** Web cluster precondition: confirm the staging web service has **`NEXT_PUBLIC_SOLANA_CLUSTER=devnet`** set explicitly (not unset, never `custom`). `NEXT_PUBLIC_SOLANA_RPC_URL` must be a **devnet** RPC (`https://api.devnet.solana.com` per RAILWAY_STAGING §0). Pointing it at another devnet RPC (e.g. a dedicated one for M4) is fine **only** with the label still `devnet`. Don't switch the label to `custom` to use a custom RPC. Since !69 that no longer turns fixtures on with a non-loopback RPC (M2), but it still breaks Explorer links and the chip. | Value is `devnet`. Per staging script, `pin_web_cluster` logs `web cluster: … NEXT_PUBLIC_SOLANA_CLUSTER=devnet (ok)` (or `set … -> 'devnet'`). If the value had to change, the web needs a rebuild/redeploy before testing (NEXT_PUBLIC_* are baked in at build), and that's the operator's job, not yours. You check the visible effects in 2.1, 2.3b and 5.7. | [ ] Pass [ ] Fail |
| 1.2c | **[operator]** Settler key precondition (M3): the automation service has the Railway secret **`SETTLER_KEYPAIR`** set (a key different from `AUTOMATION_KEYPAIR`, funded with ~0.05 devnet SOL). | Automation logs no settler-fallback warning. If it's unset, devnet automation falls back to the authority and logs a warning (`resolveSettler`, !70). That doesn't block this run, but record it, and it must be set before automation holds a funded or mainnet authority. Setting the secret needs Debu. | [ ] Pass [ ] Fail |
| 1.2d | **[operator]** Pauser precondition (!73): (a) the automation service has the Railway secret **`PHOENIX_PAUSER_KEYPAIR`** (the same key as the box `pauser.json`; different from `AUTOMATION_KEYPAIR` and `SETTLER_KEYPAIR`; ~0.02 devnet SOL for fees). (b) Every staging book's seat-manager authority is the pauser. Read-only check from `apps/automation` on the box: `SOLANA_RPC_URL=… PHOENIX_PAUSER_KEYPAIR=$KEYS_DIR/pauser.json node dist/ops-cli.js pause-status --state $STATE` (`ops/README.md`). | (a) Automation logs **no** `[worker] WARNING: PHOENIX_PAUSER_KEYPAIR unset on devnet — Phoenix books will NOT be paused at expiry` (`apps/automation/src/worker.ts`). (b) `pause-status` prints one `book <label>` line per book with `status: "Active"` (before expiry) and `seatManagerAuthority` = the pauser's pubkey (`apps/automation/src/ops-cli.ts`); the bootstrap log shows `seat-manager authority → pauser <pubkey> (PSM NameSuccessor + ClaimSeatManagerAuthority)` per book, or nothing to do for books already handed off. A book still on the upgrade key logs `[pause] ALERT …` and **won't be paused** (`skip-not-authority`); the fix is `ops-cli handoff` with `SEAT_MANAGER_AUTHORITY_KEYPAIR` (box only, never Railway). **The secret is Debu's to set** if it's missing. If only the box has the key, the box `pause-watch` / `pause-once` still pause the books for this run; record it. | [ ] Pass [ ] Fail |
| 1.3 | Phantom → Settings → Developer Settings → turn on **Testnet Mode** and choose **Solana Devnet**. | Phantom shows devnet balances. Transactions from the app are simulated against devnet. | [ ] Pass [ ] Fail |
| 1.4 | Check wallet A (your main Phantom account) balances. | **≥ 1 SOL** (the bootstrap sends ~2 SOL to your wallet; RAILWAY_STAGING §0) and an **mUSDC** balance (unknown-token row, mint `GEBRsT3N…MXq`). If either is missing, ask the operator: public devnet airdrops are rate-limited (429), and only the operator can mint mUSDC. | [ ] Pass [ ] Fail |
| 1.5 | Set up **wallet B** (a second Phantom account) for counterparty fills (§4) and the other side of the 20-min market (§7). Per staging script, wallet B is **funded at bootstrap** with 0.5 SOL + 1,000 mUSDC. Either give the operator your second Phantom address **before bootstrap** (`WALLET_B=<pubkey>`), or import the box keypair `wallet-b.json` that the operator gives you (devnet test key only). **Fallback** (the run log shows `wallet B: skipped`, or `WARNING wallet B has … SOL`): ask the operator to send ~0.5 SOL and ~1,000 mUSDC by hand. | Wallet B shows **≥ ~0.5 SOL** and **1,000 mUSDC** (mint `GEBRsT3N…MXq`) on devnet. The SOL covers the Phoenix seat claim and token accounts on its first order. | [ ] Pass [ ] Fail |
| 1.6 | **[operator]** Ask for the bootstrap summary: the Friday market addresses and which have Phoenix books, wallet B's pubkey, and the 1.1b / 1.2b log lines. | You have the market list, know which markets have books, and have wallet B's address. | [ ] Pass [ ] Fail |
| 1.7 | **[operator]** Start the 20-min AAPL ≥ 300 market when you're ready (§3–§6 done, ~30 min free). Per staging script the operator does this with `touch $OPS_DIR/START_20M` on the ops box (default `START_FILE`; or `START_20M=now bash run-staging.sh` / `--start-20m-now`). The market gets a Phoenix book + maker ladder, so you **trade it yourself in the UI** (§7). Ask for the `SHORT MARKET READY` line: market address, `phoenix=<pubkey>`, and the trade-until time (CT). | Log `SHORT MARKET READY: AAPL >= 300 — trade until <time CT> (~20+ min left; UI closes 5 s early; book PAUSED at expiry); pull settle from <expiry + 90 s>, admin_settle fallback ~<expiry + 330 s>` (`ops/run-staging.sh`). The market's Rules card ends `· phoenix <pubkey>` (not `phoenix unset`). **Fallback** (the script at your run doesn't add the book: the READY line shows `phoenix=none`, the ticket reads `Phoenix not configured — Buy Yes`, or the Rules card says `phoenix unset`): before expiry, ask the operator to transfer N Yes **and** N No of the short market to wallet A (off-book SPL transfer; vault and `pairs_*` don't move, V-08). Without either, §8 can only be checked on the operator's own redeem tx (8.7). | [ ] Pass [ ] Fail |

> **Timing (per staging script, `ops/run-staging.sh`):** the short market isn't created at bootstrap. It waits up to 24 h for your START signal (1.7). After START: book + ladder setup (~3 min), then ≥ 20 min of trading. **At expiry** the pipeline runs `ops-cli pause-once` (the book goes to `Paused`; the background `pause-watch` and the automation worker are backstops). **From expiry + 90 s** it retries the settle chain every 30 s (Pyth pull settle, then the sponsored-account settle). If the market still isn't settled **at expiry + 330 s** (`admin_settle_delay_secs` 300 + 30 s), it runs `admin_settle` at the last published AAPL Pyth price, then redeems the operator's own 5 test pairs. **Fallback** (older script without the START wait): the short market appears ~20 min after bootstrap, so be at your desk from bootstrap on.

---

## 2. Connect wallet on devnet

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 2.1 | Open `https://web-production-77fbb.up.railway.app/markets`. | Header shows **Markets / Portfolio / History**, a cluster chip reading exactly **devnet** (title `Solana cluster`; it prints `NEXT_PUBLIC_SOLANA_CLUSTER`, `components/layout/Header.tsx`), and a wallet button. A chip reading **`custom`** (or `localnet`) is a **FAIL**: wrong config. On main @ `dd46769` fixtures stay off with a non-loopback RPC (M2 fix, !69), but stop and report it (and on an older Railway SHA, fixtures **would** be live). There's no banner "You're connected to the wrong cluster…" (`components/layout/GlobalBanners.tsx`; it only compares the label with the RPC URL, `lib/solana/banners.ts`, and can't see Phantom's network, so 1.3 still matters). | [ ] Pass [ ] Fail |
| 2.2 | Before the program is bootstrapped (optional): look at `/markets`. | Empty state **"No markets on Solana devnet yet."**, or **"Markets unavailable"** on an RPC failure. No sample/fixture markets: fixtures are localnet-only since DLV-084 (`lib/indexer/index.ts`). | [ ] Pass [ ] Fail |
| 2.3 | After bootstrap: look at `/markets`. | Cards for the bootstrapped markets, e.g. **"Will AAPL close at or above $305.00?"**, with Yes/No prices, the implied %, and **Buy Yes / Buy No** links. No `fixture-…` ids in any URL. | [ ] Pass [ ] Fail |
| 2.3b | **Fixture route → 404** (M2 negative). Terminal: `curl -sI https://web-production-77fbb.up.railway.app/markets/fixture-anything`. Browser: open the same URL. | curl: first line `HTTP/2 404` (or `HTTP/1.1 404`). Browser: **Market not found** / `The page or market you requested does not exist.` with **Browse markets** (`app/not-found.tsx`). The middleware rewrites ids that aren't plausible to a 404 unless the cluster is a fixture cluster (`middleware.ts`, `lib/market/marketIdRoute.ts` `isPlausibleMarketId`, DLV-089). A 200 or a rendered sample market is a **FAIL (M2)**. Since !69 that needs a fixture label **and** a loopback RPC (`isFixtureCluster(cluster, rpcUrl)`), so on Railway it means a mis-set env or a pre-!69 SHA. | [ ] Pass [ ] Fail |
| 2.4 | Click the wallet button → **Select Wallet** → **Phantom** → approve. | The button shows your truncated address. No "Localnet Dev Wallet" option appears (`AppProviders.tsx` registers it only on localnet dev). | [ ] Pass [ ] Fail |
| 2.4b | **Dev-wallet route → 404.** Terminal: `curl -sI https://web-production-77fbb.up.railway.app/api/localnet-dev-wallet`. Browser: open the same URL. | curl: `HTTP/2 404`. Browser: `{"error":"not found"}`. The route returns 404 unless every localnet-dev gate passes (`app/api/localnet-dev-wallet/route.ts`: not `NODE_ENV=production`, cluster `localnet`, loopback RPC/Host/XFF, keypair env). **Any** response containing `secretKey` is a **blocker**. (If curl `-I` ever returns 405, rerun as a GET: `curl -s -o /dev/null -w '%{http_code}\n' <url>` must print `404`.) | [ ] Pass [ ] Fail |
| 2.5 | Open a market with a book (e.g. AAPL ≥ 305). | Trade page shows the question, an underlying line `AAPL $… · Pyth · Ns ago`, **Yes / No** price buttons (book perspective), a countdown **"Closes in …"**, the order book, **Position / Open orders / Fills** tabs, and the **Order ticket** with **Buy Yes / Sell Yes / Buy No / Sell No** and **Market / Limit** (`app/markets/[marketId]/TradeClient.tsx`, `components/trade/TradeTicket.tsx`). The Rules card ends with `marketId … · program 9Rb7nx… · phoenix <pubkey>`. | [ ] Pass [ ] Fail |
| 2.6 | Note the ticket footer. | `Wallet USDC <your mUSDC balance>` (the ticket reads `NEXT_PUBLIC_USDC_MINT`). If it shows 0 but Phantom shows mUSDC, the Railway `NEXT_PUBLIC_USDC_MINT` doesn't match `GEBRsT3N…`. Report that as a staging config defect. | [ ] Pass [ ] Fail |

---

## 3. Four intents × Market and Limit

Do this on one market **with a Phoenix book** (AAPL ≥ 305 recommended). Start flat (Position tab: **"No position. You can buy Yes or No."**). Keep sizes small (5).

> **Whole contracts only.** Every size in this plan is a whole number of contracts (1 lot = 1 contract on staging). Don't type fractions. What the code does with a fractional size on main @ `dd46769` (Reviewers **M1** fix, !67):
> - **Ticket:** `lotSizeError` (`lib/phoenix/size.ts`) runs on every size change (`components/trade/TradeTicket.tsx`). A size that isn't a positive whole number of lots shows the inline error **`Size must be a whole number of contracts.`** (`Enter a size greater than 0.` for 0), and the submit button is **disabled**. Nothing reaches Phantom.
> - **Order path:** `placePhoenixOrder` (`lib/phoenix/client.ts`) repeats the check before anything is loaded or signed (`invalid-size`). Then `contractsToLots` derives **one integer lot count** from the loaded Phoenix market, and that count drives the `mint` / `merge_pair` raw amount, the Phoenix size and the fill-or-kill minimum. The mint and the Phoenix leg can't disagree any more.
> - **Program:** `mint` / `merge_pair` / `redeem` still take raw u64 amounts with no lot check. Only the app enforces whole contracts, so other clients can still mint fractions. That doesn't affect this run.
> - **Before !67** (main ≤ `ea84698`): fractions were accepted. Market Buy No 2.5 minted 2.5 pairs and sold only 2 Yes, leaving 0.5 Yes + 2.5 No, and a seat sweep could let a fractional Sell No consume your Yes (L12). If Railway is deployed from an older SHA (see Sign-off), 3.11 will **FAIL**. Report it, and use whole numbers only.

How the intents are composed (D-018, !28, !33, `lib/phoenix/compose.ts`, `lib/phoenix/client.ts`):

- **Buy Yes** = Phoenix bid on the Yes/USDC book.
- **Sell Yes** = Phoenix ask.
- **Buy No** = Meridian `mint` (USDC → Yes+No) + ask Yes @ `1 − p_no` in **one tx**.
- **Sell No** = bid Yes @ `1 − p_no`. If it's a Market order, `merge_pair` (Yes+No → USDC) goes in the same tx. A resting limit Sell No places the bid only.
- **Market** orders are fill-or-kill at the touch ± $0.02 (D-024). They either fill completely or the whole tx reverts.

Toasts: `Submitted — confirming…` first, then (only after the tx confirms without an error, L14 fix in !67) the success toast `Submitted <packaging> (<bid|ask> Yes @ <price> × <size>). … · <first 8 chars of the sig>…`. A tx that fails on-chain shows `Transaction failed on-chain (…)`; a timeout shows `Sent but not confirmed yet — check the explorer before retrying` (`lib/solana/confirm.ts`). Packaging is `phoenix-only`, `mint-then-phoenix`, `phoenix-then-merge` or `phoenix-then-merge-todo`.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 3.1 | **Buy Yes · Market · 5** → press `Buy Yes 5`, approve in Phantom. | Ticket line before submit: `Market fills at best Yes 0.xx (up to 0.yy).` Toasts: `Submitted — confirming…`, then `Submitted phoenix-only (bid Yes @ … × 5). · <sig>…`. Within a few seconds (own trades refresh the caches at once; otherwise the trade page re-reads every 10 s, `lib/rpc/pollPolicy.ts`) the Position tab shows **Yes 5** and wallet mUSDC drops by about 5 × ask. Fills tab gets a **Buy Yes** row. | [ ] Pass [ ] Fail |
| 3.2 | **Buy Yes · Limit · 5** at a price **at or above** the best ask (click an ask row in the book; it highlights and fills the Limit price) → `Buy Yes 5 @ 0.xx`. | Crosses and fills right away as taker. **Yes 10** in the wallet. No Open-orders row. | [ ] Pass [ ] Fail |
| 3.3 | **Sell Yes · Market · 5** → `Sell Yes 5`. | Toast `Submitted phoenix-only (ask Yes @ … × 5)…`. **Yes 5**. mUSDC rises by about 5 × bid. | [ ] Pass [ ] Fail |
| 3.4 | **Sell Yes · Limit · 5** at or below the best bid (click a bid row) → `Sell Yes 5 @ 0.xx`. | Fills as taker. Position back to **"No position."** | [ ] Pass [ ] Fail |
| 3.5 | **Buy No · Market · 5** → `Buy No 5`. | Ticket shows `Buy No: mint pair then ask Yes @ 0.xx (multi-ix tx).` Toast includes `Submitted mint-then-phoenix … Mint + ask packed in one tx (transient Yes+No OK).` Position **No 5**, Yes 0. mUSDC drops by 5 − (5 × Yes bid) = 5 × No price. | [ ] Pass [ ] Fail |
| 3.6 | **Buy No · Limit · 5** at a No price that crosses (switch perspective to **No** and click an ask row) → `Buy No 5 @ 0.xx`. | Mint + ask fills right away. **No 10**. | [ ] Pass [ ] Fail |
| 3.7 | **Sell No · Market · 5** → `Sell No 5`. | Ticket shows `Sell No (market): bid Yes then merge_pair in one tx.` Toast includes `… Bid + merge_pair packed in one tx (immediate Sell No).` **No 5**, no Yes left over. mUSDC rises. | [ ] Pass [ ] Fail |
| 3.8 | **Sell No · Limit · 5** at a crossing No price → `Sell No 5 @ 0.xx`. | Ticket shows `Sell No (resting): bid Yes only — merge_pair on fill not automatic yet.` Toast includes the caveat `Sell No resting orders place Bid Yes at 1−p_no only. merge_pair on fill is not automatic yet…`. The bid fills, so you now hold **Yes 5 + No 5**, and the Position card reads **"Both sides held"**. **Automatic merge on fill: pending feature: not on main @ 7219ac1 (DLV-069).** Pass = the behavior above. | [ ] Pass [ ] Fail |
| 3.9 | Unwind 3.8: **Sell Yes · Market · 5**, then **Sell No · Market · 5**. | Flat again: **"No position."** | [ ] Pass [ ] Fail |
| 3.10 | Negative check (D-024): **Buy Yes · Market** with a size larger than the visible ask depth (e.g. 100000). | Error toast `No fill: the book doesn't have 100000 Yes at 0.xx or better. Nothing was traded — try a smaller size or a Limit order.` (`lib/phoenix/errors.ts`). No balance change. Phantom may warn that the simulation fails. Rejecting it there also passes, and the toast is then `Wallet rejected the transaction.` The same check with free seat funds is 4.10. | [ ] Pass [ ] Fail |
| 3.11 | M1 regression: on **Buy No · Market**, type size **2.5**. Then try **0.5** and **Sell No · Market · 2.5**. | Each time, the inline error `Size must be a whole number of contracts.` appears under the size box and the **Buy No / Sell No button is disabled**, so Phantom never opens (`lotSizeError`, !67). If Phantom **does** open, **reject it** and record **FAIL**: Railway is probably on a SHA before !67. | [ ] Pass [ ] Fail |

---

## 4. Resting limit filled by wallet B, then cancel and withdraw (DLV-087)

On main via !63 (`components/portfolio/PhoenixActions.tsx`, `lib/phoenix/manage.ts`, `components/trade/PositionPanel.tsx`). Maker fills land in your **Phoenix trader account (seat)**, not your wallet.

> **Run §4 before the Friday expiry (Fri 2026-10-09, 3:00 PM CT).** After a book's expiry it is **paused** (!73, §7 box): 4.1, 4.3, 4.9, 4.10, 4.11 and the Sell in 4.12 can't place orders any more (the ticket shows **Trading closed**), while **Withdraw to wallet** (4.6), **Cancel** / **Cancel all** (4.7, 4.12) and Portfolio → Phoenix balances (4.5, 4.8) keep working on a paused book. The post-expiry version of these checks is 7.3b.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 4.1 | Wallet A, flat: **Buy Yes · Limit · 10** at a price **between** best bid and best ask. Per staging script the maker ladder is fair ± 0.01 (AAPL ≥ 305 has fair 0.50), so this is the one tick in the middle, e.g. **0.50** on a 0.49 / 0.51 book. Scale the USDC amounts below to your price. | Toast `Submitted phoenix-only (bid Yes @ 0.50 × 10)…`. Within ~6 s (book poll, `pollPolicy.ts` `tradeBook`) the book shows a new bid level of 10 at 0.50. **Open orders (1)** lists `Buy Yes · 0.50 · 10 · [Cancel]` with the note `Resting buys count toward the one-side rule. Cancelling returns funds to your wallet.` Wallet mUSDC drops by 5.00 (locked in Phoenix). | [ ] Pass [ ] Fail |
| 4.2 | Opposite-side check while resting: look at **Buy No**. | Disabled with `You have open Buy Yes orders (10 contracts). Cancel them before buying No.` (`lib/intents/getIntentAvailability.ts`). | [ ] Pass [ ] Fail |
| 4.3 | Switch Phantom to **wallet B** (reconnect in the app). On the same market: **Buy Yes · Market · 4**, then **Sell Yes · Limit · 4** at **0.50** (click your 0.50 bid row). | B's sell crosses A's bid. B's wallet: Yes −4, mUSDC +2.00. The book's 0.50 level drops from 10 to **6**. | [ ] Pass [ ] Fail |
| 4.4 | Switch back to **wallet A**. Open the trade page Position tab. | Position **Yes 4 (4 in Phoenix)**. Card **Phoenix trader account**: `Free 4 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC` with a **Withdraw to wallet** button. Open orders: `Buy Yes · 0.50 · 6`. **Buy No** disabled (`You hold 4 Yes in this market. Close your Yes position before buying No.`); seat Yes counts as held. | [ ] Pass [ ] Fail |
| 4.5 | Before withdrawing, open **Portfolio**. | **Positions** card for this market shows chips `YES 4` and `4 Yes in Phoenix`, plus a **Withdraw to wallet** button. Tile **In Phoenix (withdrawable)** reads `0.00 USDC · 4 Yes`. **Phoenix balances (1)** tab: `Free 4 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC` with **Withdraw to wallet**. Footnote: `Fills of your resting orders land in your Phoenix trader account. New orders sweep it to your wallet automatically; Withdraw does it now.` | [ ] Pass [ ] Fail |
| 4.6 | Back on the trade page, click **Withdraw to wallet** → approve. | Toast `Withdrew your Phoenix balance to your wallet. · <sig>…`, shown only after the tx confirms (L14). Wallet Yes = 4 (seat free = 0). The 6 @ 0.50 order **is still resting**. | [ ] Pass [ ] Fail |
| 4.7 | In Open orders, click **Cancel** on the 6 @ 0.50 order → approve. (With 2+ orders, **Cancel all (N)** also appears.) | Toast `Cancelled 1 order; funds returned to your wallet. · <sig>…`. The order is gone from the book and from Open orders (`No resting orders on this market.`). Wallet mUSDC +3.00. | [ ] Pass [ ] Fail |
| 4.8 | **Portfolio → Phoenix balances** after the cancel. | This market's card is gone, because seats with all-zero balances aren't listed. With no seat balance anywhere, the tab reads `No Phoenix trader accounts yet — one is created with your first limit order.` | [ ] Pass [ ] Fail |
| 4.9 | **Set up free seat funds next to a resting order.** Repeat 4.1 (wallet A: Buy Yes · Limit · 10 @ 0.50) and 4.3 (wallet B: Buy Yes · Market · 4, Sell Yes · Limit · 4 @ 0.50). Switch back to wallet A and **don't** withdraw. Write down wallet A's Yes and mUSDC from Phantom. | Position **Yes 8 (4 in Phoenix)**. **Phoenix trader account**: `Free 4 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC`. Open orders: `Buy Yes · 0.50 · 6`. Wallet Yes = 4 (left from 4.6). | [ ] Pass [ ] Fail |
| 4.10 | **Atomicity: a failed fill-or-kill leaves the seat unchanged.** With the seat from 4.9, place the 3.10 order: **Buy Yes · Market · 100000** (approve if Phantom lets you; rejecting also passes). | Before submit the ticket shows the sweep line `Also moves 4 Yes from your Phoenix account to your wallet.` (L11, `lib/phoenix/sweepCopy.ts`). Error toast `No fill: the book doesn't have 100000 Yes at 0.xx or better. Nothing was traded — try a smaller size or a Limit order.` (or `Wallet rejected the transaction.`). **Seat unchanged**: still `Free 4 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC`. `Buy Yes · 0.50 · 6` still resting. Wallet Yes and mUSDC unchanged (Phantom may show a tx fee only if the tx was sent and failed on-chain). The prepended WithdrawFunds sweep is in the **same tx** as the order (`lib/phoenix/client.ts` `buildPhoenixPlaceIx` → `sweep`, `lib/phoenix/manage.ts` `seatSweepIxs`), so the fill-or-kill failure (Phoenix `0xf`) reverts the sweep too (!54 all-or-nothing). | [ ] Pass [ ] Fail |
| 4.11 | **Auto-sweep with a resting order.** Still wallet A: **Buy Yes · Market · 1**. Use a Buy so it lifts the maker's ask. A Sell would hit your own 0.50 bid first, and `SelfTradeBehavior.Abort` would revert it. | Before submit the ticket shows `Also moves 4 Yes from your Phoenix account to your wallet.` After confirm, the success toast is `Submitted phoenix-only (bid Yes @ 0.xx × 1). Also moved 4 Yes from your Phoenix account to your wallet. · <sig>…` (L11 disclosure, !67). If the sweep line or the `Also moved…` text is missing, record **FAIL** (Railway on an older SHA). After ~4 s: wallet **Yes +5** vs 4.9 (4 swept from the seat + 1 bought); mUSDC −(1 × ask), since the sweep moved 0.00 USDC. **Phoenix trader account**: `Free 0 Yes · 0.00 USDC — In orders 0 Yes · 3.00 USDC` (seat free = 0). **The resting order is still resting**: Open orders `Buy Yes · 0.50 · 6`, and the book's 0.50 level still shows 6. WithdrawFunds moves only *free* funds and never cancels orders (`seatSweepIxs` adds it only when `baseLotsFree + quoteLotsFree > 0`). | [ ] Pass [ ] Fail |
| 4.12 | Close out: **Cancel** the 6 @ 0.50 order (mUSDC +3.00), then **Sell Yes · Market** for all of wallet A's Yes on this market. On wallet B, sell anything left over. | Both wallets flat on this market. Open orders empty. | [ ] Pass [ ] Fail |

---

## 5. Portfolio and History show real on-chain data (DLV-088)

On main via !63 (`app/portfolio/page.tsx`, `app/history/page.tsx`, `lib/portfolio/readAccount.ts`, `lib/history/*`). Demo data appears only in localnet fixture mode (`lib/portfolio/demoMode.ts`).

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 5.1 | Wallet A holding something (e.g. **Buy Yes · Market · 5** on one market and **Buy No · Market · 5** on another). Open **Portfolio**. | Tiles: **Portfolio value**, **USDC in wallet**, **Positions (mark)**, **In Phoenix (withdrawable)**, **Redeemable now**. Footnote reads `On-chain: wallet token accounts + Phoenix trader accounts. Marks use the Yes mid.` It must **not** read `Localnet fixture mode — demo balances, not on-chain.` **USDC in wallet** equals Phantom's mUSDC. | [ ] Pass [ ] Fail |
| 5.2 | **Positions** tab. | One card per market you hold, with the real chips `YES 5` / `NO 5`, `Mark … · Value … USDC · Pays 5.00 if right`, and **Sell** / **Trade** buttons. No markets you never traded. Nothing like fixture "demo" markets. | [ ] Pass [ ] Fail |
| 5.3 | **Open orders** tab (place one resting limit first, as in 4.1). | Row `<question> · Buy Yes · 0.50 · 10 · [Cancel]`. With none: `No resting orders on Phoenix.` | [ ] Pass [ ] Fail |
| 5.4 | Switch Phantom to **wallet B** with the app open. | Portfolio refreshes to B's balances, not A's. | [ ] Pass [ ] Fail |
| 5.5 | Header redeem dot. | No dot next to **Portfolio** while nothing is redeemable. After §7/§8 settle, a dot appears **only** if you hold the winning side (hover: `Redeemable: N.NN USDC`). | [ ] Pass [ ] Fail |
| 5.6 | Open **History**. | `Reading your transactions…`, then rows from **this wallet's own transactions** (last 100). Columns: **Time, Type, Market, Intent / Outcome, Price, Size, USDC, Yes / No, Tx**. Expect e.g. `trade · Buy Yes`, `trade · Buy No`, `trade · Sell No`, `order · Limit bid (resting)`, `cancel · Cancel order`, `withdraw · Withdraw from Phoenix`. Tabs: **All, Fills, Orders, Cancels, Withdraw / mint / merge, Settlements, Redemptions**. A wallet that has never traded shows `No Meridian activity for this wallet yet.` | [ ] Pass [ ] Fail |
| 5.7 | Click a **Tx** link in History. | Opens Solana Explorer **with `?cluster=devnet`** on the matching tx. | [ ] Pass [ ] Fail |
| 5.8 | **Export CSV**. | A CSV downloads with on-chain deltas. Times are ISO-8601 UTC + America/Chicago. | [ ] Pass [ ] Fail |
| 5.9 | Trade page **Fills** tab footnote. | `Your taker fills from this wallet's transactions; resting-order fills show in Position → Phoenix.` | [ ] Pass [ ] Fail |
| 5.10 | Known gap: look for wallet B's fill of your resting bid (from 4.3) in **wallet A's** History. | It is **not** listed as a fill. It shows up only through your later withdraw/cancel row and the seat balance. **Maker-fill rows in History: pending feature: not on main @ 7219ac1** (TRACKER Todo, follow-up to DLV-088). Pass = the behavior above. | [ ] Pass [ ] Fail |

---

## 6. Opposite-side block

Rule: the trading UI won't let you hold Yes and No in the same market at once (docs/ui/06 §2). It's implemented as a UI gate in `lib/intents/getIntentAvailability.ts`, fed by live wallet + seat + resting orders (`lib/intents/resolveInputs.ts`, !63). The **program does not block it, by design**: `mint` gives you both, and Buy No is mint + ask. TEST_RESULTS hardening E2E case 4: "The program does not block it (by design)." So you can't test a program-level block from Phantom. Pass = the UI gate below.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 6.1 | Hold **Yes 5** (Buy Yes · Market · 5). Look at the ticket. | **Buy No** button disabled (D-022 dashed/greyscale). Selecting it shows `You hold 5 Yes in this market. Close your Yes position before buying No.` with a CTA **Sell 5 Yes**. Position card: `Buy No unavailable while you hold Yes.` | [ ] Pass [ ] Fail |
| 6.2 | Click the **Sell 5 Yes** CTA. | Ticket switches to **Sell Yes** with size 5. | [ ] Pass [ ] Fail |
| 6.3 | On `/markets`, find the same market card. | Badge `You: Yes 5`. **Buy No** link disabled with title `You hold Yes — sell it first` (`lib/intents/shortCopy.ts`). | [ ] Pass [ ] Fail |
| 6.4 | Open `/markets/<id>?intent=buy-no` while holding Yes. | Banner with the blocked copy. The ticket falls back to an enabled intent. | [ ] Pass [ ] Fail |
| 6.5 | Flip: sell the Yes, **Buy No · Market · 5**. | **Buy Yes** disabled: `You hold 5 No in this market. Close your No position before buying Yes.`, CTA **Sell 5 No**. Card badge `You: No 5`. | [ ] Pass [ ] Fail |
| 6.6 | Resting-order version: covered by 4.2 (open Buy Yes blocks Buy No). | As in 4.2. | [ ] Pass [ ] Fail |
| 6.7 | While a wallet read is pending (reload the trade page and watch the first second). | Ticket intents are locked with `Checking your balances…` instead of assuming flat. | [ ] Pass [ ] Fail |
| 6.8 | (Optional, **[operator]**, Reviewers M5) Make the **first** balance read fail (e.g. the RPC answers 429 or is blocked for the page's first read) while holding Yes, then look at the ticket. | The ticket stays **locked** (fails closed): intents show `Couldn't read your balances. Retrying…` with a **Retry** button (`lib/intents/resolveInputs.ts` `BALANCES_ERROR_COPY`, `TradeTicket.tsx`; M5 fix in !67). **Buy No is not enabled.** Hard to stage by hand; skip if you can't force the error. | [ ] Pass [ ] Fail |

---

## 7. 20-minute AAPL market: trade, pause at expiry, then settle (Pyth pull → sponsored → admin_settle)

Market: **AAPL ≥ 300**, created on your START signal (1.7). Per staging script it has a **Phoenix book** (maker ladder around 0.50), so the normal ticket works on it. The Rules card ends `· phoenix <pubkey>`. **Fallback** (a run without the book): the ticket CTA reads **`Phoenix not configured — Buy Yes`**, the Rules card ends `· phoenix unset` (`lib/indexer/mapStrikeMarket.ts` `phoenixOrUndefined`, `lib/phoenix/config.ts`), and you use the operator token transfer from 1.7 instead of 7.2.

How settlement works today:

- **Permissionless settle** reads a Pyth pull-oracle `PriceUpdateV2` that holds the **first AAPL update at/after expiry**, published within 60 s of it (D-025; `prev_publish_time < expiry_ts <= publish_time ≤ expiry_ts + 60 s`). Any signer may call it (`Settle.settler` is a bare `Signer`). Two ways to get that account (`apps/automation/src/solana/pullSettle.ts` `settleWithPullOracle`):
  - **Sponsored:** the market's registered Pyth feed account (`StrikeMarket.pyth_price_feed`, the shard-0 receiver-owned `PriceUpdateV2` that Pyth keeps updated). If it already holds the expiry price, `settle` uses it directly, with **no Hermes call** (`PULL_SETTLE_OK via=sponsored`). RAILWAY_STAGING §0 notes the shard-0 MAG7 accounts are stale on both clusters, so expect this to miss on devnet.
  - **Hermes:** fetch `/v2/updates/price/{expiry_ts}` with `PYTH_HERMES_API_KEY` (Bearer header), post it fully verified through the Pyth receiver, then `settle` against the posted account (`PULL_SETTLE_OK via=posted`). Without the key: `PULL_SETTLE_FAILED … (needs PYTH_HERMES_API_KEY)` / `needsApiKey: true`. TRACKER DLV-085 records the key as set on Railway `automation`; the **box** pipeline needs it in its own process env (`ops/run-staging.sh` logs `PYTH_HERMES_API_KEY set|MISSING`, name only).
- **Order of attempts.** Box pipeline for the 20-min market (`ops/settle-test.cjs settle`, run by `ops/run-staging.sh` from expiry + 90 s): **(1)** `ops-cli pull-settle` = sponsored, then Hermes (skipped with `pull settle skipped: PYTH_HERMES_API_KEY unset; …` if the key isn't in the box env); **(2)** the legacy `settle` against the stored sponsored Pyth account; **(3)** after expiry + 330 s, `admin_settle` at the last published price (`ops/pyth-read.py`). Automation worker (Friday markets): sponsored → Hermes → `admin_settle` only after 20 failed tries **and** a fixed `ADMIN_SETTLE_PRICE_E6` / `ADMIN_SETTLE_OUTCOME_YES` (`apps/automation/src/modes/calendar.ts`, `config.ts`).
- **Who signs what (M3 !70, pauser !73):** permissionless `settle` and the Hermes post are signed **and paid** by the separate low-balance **settler** (`SETTLER_KEYPAIR` on Railway, `settler.json` on the box), never the config authority (`apps/automation/src/config.ts` `resolveSettler`: throws if it equals the authority, required on mainnet-beta; `ops-cli pull-settle` refuses to run without it). `admin_settle`, market creation and `set_phoenix_market` stay with the config **authority** `CCt1…` (keeper; `admin_settle` is `has_one = authority`). The Phoenix **pause** is signed by the **pauser** (`PHOENIX_PAUSER_KEYPAIR` / `pauser.json`), which is neither of those. Unset `SETTLER_KEYPAIR` on devnet → authority fallback with a warning (1.2c); missing box `settler.json` → keeper + `WARNING settler key … missing`. The prod LiteSVM test PULL-M3 settles with a non-authority key holding 0.01 SOL (`tests/prod/settle_pull_oracle.ts`).
- The calendar worker only runs settle passes at or after 16:00 ET (`apps/automation/src/schedule.ts` `assertSettleAllowedCalendar`), so for the 20-min market **the box pipeline settles it** (`ops/run-staging.sh` step 7). The `admin_settle` in step (3) is signed by the config authority.
- **`admin_settle` rules** (`programs/meridian/src/instructions/admin_settle.rs`):
  - signer must be the Config authority (`Unauthorized` 6012);
  - market must be Open (`MarketNotOpen` 6001);
  - chain time must be ≥ `expiry_ts + admin_settle_delay_secs` (300 s on staging), else `AdminSettleTooEarly` (6011 / `0x177b`);
  - price > 0;
  - **Policy A**: `outcome_yes` must equal `price ≥ strike`, else `OutcomeInconsistent` (6022).
- The UI timeline comes from `lib/market/countdown.ts` (close = settle = `expiry_ts`; trading disabled 5 s early).

> **At expiry the Phoenix book is paused (!73).** The UI ticket turns into **Trading closed** 5 s before expiry (`lib/market/countdown.ts` `CLOSE_BUFFER_SECS`). On-chain, at `expiry_ts` the **pauser** sends PSM `ChangeMarketStatus` → **`Paused`** for the book (`apps/automation/src/phoenix/pauseAtExpiry.ts`; box: `ops-cli pause-once` for the 20-min market, `pause-watch` as backstop).
> - **Blocked on a paused book:** every new order. Phoenix rejects limit/post orders with the log `Post only order is not allowed, market status is Paused` and market (IOC / fill-or-kill) orders with `FOK and IOC orders are not allowed, market status is Paused`; the tx error is `invalid account data for instruction` (`ProgramError::InvalidAccountData`; phoenix-v1 `assert_post_allowed` / `assert_cross_allowed`). Other Phoenix clients can't pick off resting orders any more.
> - **Still allowed:** cancel (one order or all) and withdraw from the Phoenix seat. Phoenix `reduce_allowed` includes `Paused` (`ops/README.md`).
> - **Meridian side, unchanged:** after expiry `mint` fails (`MintAfterExpiry` 6004, so no Buy No), and `merge_pair` still works while the market is Open (MP-02).
> - **The app has no Paused indicator and no paused-specific error copy.** The ticket is already closed, so you won't see a Phoenix rejection in the UI. If one ever reached the app (e.g. a tab whose ticket hadn't closed), it would show the generic toast `Phoenix place failed: <wallet/RPC message>` (`lib/phoenix/client.ts`). `lib/phoenix/errors.ts` maps only Meridian codes ≥ 6000 and Phoenix `0xf`, and its `Trading is paused by the operator. Nothing was traded.` copy is for the **Meridian** config pause (6000), not the Phoenix book status.
>
> **Window between expiry and the pause landing.** The pause isn't in the same instant as expiry:
> - box `pause-once` starts when the box clock passes expiry (5 s polling loop) + tx confirmation;
> - the automation worker pauses on its tick (`WORKER_TICK_MS`, 60 s default) plus an exact-time follow-up timer 0.5 s after the due time when that comes before the next tick (`followUpDelayMs`);
> - box `pause-watch` polls every 30 s (`PAUSE_POLL_MS`).
>
> A failed pause is retried on the next pass and logs `[pause] ALERT pause FAILED for book …`. A pause landing ≥ 120 s after expiry logs `[pause] ALERT book … paused Ns after expiry (late)` (`PHOENIX_PAUSE_ALERT_SECS`). A book whose seat-manager authority isn't the pauser is skipped with an ALERT (needs `ops-cli handoff`). Until the pause lands, the book behaves as before !73 (still tradeable by other Phoenix clients). So **still cancel your resting orders before expiry** if you don't want them exposed, and record in 7.3c how long after expiry the book showed `Paused`.
>
> After settle the trade page hides the book (Settlement proof card instead) and stops reading Phoenix for that market (M4 poll policy, `lib/rpc/pollPolicy.ts` `accountRefsFor`). Use **Portfolio → Open orders / Phoenix balances**, which still read settled markets' seats, for any leftovers.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 7.1 | Open the short market page **before** expiry. | Countdown `Closes in mm:ss` (amber while under 1 h). Underlying line `AAPL $… · Pyth`. Order book with the maker ladder (best bid 0.49 / best ask 0.51 per staging script). Ticket with **Buy Yes / Sell Yes / Buy No / Sell No**. | [ ] Pass [ ] Fail |
| 7.2 | Take **both** sides so one of your wallets wins: wallet A **Buy Yes · Market · 5**, wallet B **Buy No · Market · 5** (whole contracts). | A: Position **Yes 5**. B: Position **No 5** (`mint-then-phoenix` toast as in 3.5). **Fallback** (no book): the operator transfer from 1.7 instead. | [ ] Pass [ ] Fail |
| 7.2b | **[operator]** Run §11 checkpoint A on this market (after the maker's 3,000-pair mint, the operator's 5-pair mint and B's Buy No). | Vault == Yes supply == No supply == `pairs_minted`. | [ ] Pass [ ] Fail |
| 7.3 | Watch through expiry, reloading the page. | About 5 s before expiry the ticket turns into **"Trading closed"** with `Redeem winning positions from Portfolio after settlement.` After expiry the countdown reads **`Resolving with Pyth…`**. The page stays like this while the market is Open on-chain (before settle): no settlement proof yet; chart stub and order book **still visible** (the trade page shows the book while the Meridian market status is Open; it shows the last resting levels, but the book is **Paused** once 7.3c passes). On `/markets` the market has left the default **Open** filter; pick Status **Closed** to find it. | [ ] Pass [ ] Fail |
| 7.3b | **Paused book: trading blocked, cancel and withdraw still work.** Before expiry, wallet A places **three** resting orders below the ladder: **Buy Yes · Limit · 1** at **0.45**, **0.44** and **0.43** (Open orders (3)). If the Position tab's **Phoenix trader account** card shows free funds with **Withdraw to wallet**, leave them there. Let the market pass expiry and wait until 7.3c shows `Paused`. Then: **(a)** look at the ticket and try to trade; **(b)** Open orders → **Cancel** on the 0.45 order → approve; **(c)** **Cancel all (2)** → approve; **(d)** if the seat still has free funds, **Withdraw to wallet** → approve. | **(a)** You can't post or cross: the ticket is **Trading closed** (no intent buttons, no submit button). On-chain, any new order on this book now fails: Phoenix logs `Post only order is not allowed, market status is Paused` (limit) or `FOK and IOC orders are not allowed, market status is Paused` (market), with error `invalid account data for instruction` (§7 box). There's no paused-specific toast in the app. **(b)** Toast `Cancelled 1 order; funds returned to your wallet. · <sig>…`. mUSDC +0.45. The order is gone from Open orders and the book. **(c)** Toast `Cancelled 2 orders; funds returned to your wallet. · <sig>…` (`lib/phoenix/manage.ts`). mUSDC +0.87. Open orders reads `No resting orders on this market.` **(d)** Toast `Withdrew your Phoenix balance to your wallet. · <sig>…`, and the seat's free balance goes to 0. **FAIL (blocker for !73)** if any of (b)–(d) fails on a paused book, or if anything fills against your orders **after** the pause landed. A fill between expiry and the pause is the known window (§7 box); record it. **Fallback** (7.3c never shows `Paused`: no pauser key, no handoff or a failed pause): cancel still works on an Active book. Record 7.3b as **blocked by 7.3c**. | [ ] Pass [ ] Fail |
| 7.3c | **Book status = Paused.** Read-only, after expiry. **[operator]** `ops-cli pause-status --state $STATE` (1.2d), or ask for the pipeline lines right after expiry: `ops-cli pause-once` then `pause-status … \| grep -F '[20-min]'` (`ops/run-staging.sh` step 6b), plus the automation log `paused book at expiry {book, phoenix, strike, expiryTs, lateSecs, sig}`. **Anyone:** `solana account <phoenix pubkey from the Rules card> -u devnet --output json` and read the Phoenix market header: bytes 8–15 = `status` (u64 LE) (`apps/automation/src/phoenix/seatManager.ts` `decodePhoenixMarketStatus`). | `pause-status` shows the 20-min book with `status: "Paused"` and `seatManagerAuthority` = pauser. Header `status` = **3** (`Paused`; 1 = Active, 2 = PostOnly, 4 = Closed). The pause tx in Explorer calls the Seat Manager `PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1` (ix 8 → Phoenix `ChangeMarketStatus`), signed by the pauser. `lateSecs` / the pause tx time should be within seconds of expiry (box `pause-once`) and ≤ 120 s in any case; a `[pause] ALERT … (late)` or `pause FAILED` line is a **FAIL** to report. The UI has **no** Paused indicator, so this step can't be done from the app. | [ ] Pass [ ] Fail |
| 7.4 | **[operator]** Before `expiry + 300 s`: try `admin_settle`. (Optional; proves the delay.) | Tx fails with `AdminSettleTooEarly` (custom error `0x177b`). Market stays Open. | [ ] Pass [ ] Fail |
| 7.5 | **[operator]** Settle chain, from expiry + 90 s (`ops/run-staging.sh` step 7 → `ops/settle-test.cjs settle`, settler-signed). Ask for the `settle path:` log line and the `pull-settle market=… settler=… hermesKey=set\|MISSING` line. | One of: **(a)** `PULL_SETTLE_OK via=sponsored` (settled from the market's sponsored feed account, no Hermes call), **(b)** `PULL_SETTLE_OK via=posted` (Hermes price at expiry posted through the Pyth receiver, then `settle`), or **(c)** both pull and legacy `settle` fail and the market stays Open, e.g. `PULL_SETTLE_FAILED reason=… (needs PYTH_HERMES_API_KEY)` / `pull settle skipped: PYTH_HERMES_API_KEY unset; …`, or program errors `InvalidPythAccount` (6005), `StalePythPrice` (6006), `PythPriceNotAtExpiry` (6024): no AAPL update within 60 s after expiry (e.g. outside US equity hours). After (a)/(b) the explorer log shows a `Settled` event, market `status` 2 or 3, and the signer is the **settler**, not `CCt1…`; skip 7.4 and 7.6. After (c) go to 7.6. | [ ] Pass [ ] Fail |
| 7.6 | **[operator]** Only if 7.5 didn't settle: after `expiry + 300 s` (pipeline: from expiry + 330 s), `admin_settle(price_e6, outcome_yes)` with `outcome_yes = price_e6 ≥ 300_000_000`, signed by the config authority. Per staging script, `price_e6` = the last published AAPL Pyth price (`ops/pyth-read.py`; log `pull settle did not land by expiry+330s — admin_settle fallback price AAPL e6=…`). Share the tx signature. | Tx succeeds. The explorer log shows an `AdminSettled` event. Market `status` = 2 (SettledYes) or 3 (SettledNo). `settlement_price_e6`, `settled_at_ts` and `settled_slot` are set. The pipeline's `settle path:` line reads `admin_settle price=…`. | [ ] Pass [ ] Fail |
| 7.7 | **[operator]** (Optional) a second `admin_settle` or `settle` on the same market. | Fails with `MarketNotOpen` (6001). The outcome is immutable (I4). | [ ] Pass [ ] Fail |
| 7.8 | Reload the short market page. | Countdown `Settled: Yes · AAPL closed $X ≥ $300.00` (or `Settled: No · AAPL closed $X < $300.00`). The chart stub and book are gone and the **Settlement proof** card shows instead (§9). Ticket: **"Trading closed"**. | [ ] Pass [ ] Fail |
| 7.9 | `/markets`. | A **Recently settled (N)** chip appears. Filtering by it lists the short market with **View settlement proof →** instead of Buy links. | [ ] Pass [ ] Fail |
| 7.10 | Run §11 checkpoint C (after settle). | Vault, supplies and `pairs_*` are **unchanged** by settle. Only the status/settlement fields change. | [ ] Pass [ ] Fail |

---

## 8. Redeem the winning side

On main: `components/portfolio/RedeemButton.tsx` (Portfolio → **Redeemable**). Rows come from real winning-side balances on settled markets (`lib/portfolio/account.ts` `redeemableRows`, !63). Program rules (`instructions/redeem.rs`): the market must be settled (`MarketNotSettled` 6002), and only the winning mint redeems (`InvalidWinningMint` 6010). Payout = amount − redeem fee, and the fee is 0 on staging.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 8.1 | After 7.8, with the **winning** wallet from 7.2 (or wallet A with the 1.7 fallback tokens): look at the Header and **Portfolio**. | Red dot next to **Portfolio** (hover `Redeemable: N.00 USDC`). Tile **Redeemable now** = N.00 USDC. Tab label **Redeemable (1)**. | [ ] Pass [ ] Fail |
| 8.2 | Trade page of the short market → Position tab. | Card **Redeem**: `Settled Yes. Your N Yes → N.00 USDC.` (or the No version), and `Use Portfolio → Redeemable to submit the on-chain redeem instruction.` If you held both sides, the losing side shows no payout. | [ ] Pass [ ] Fail |
| 8.3 | **Portfolio → Redeemable** → row `<question>` / `Settled Yes · N contracts · N.00 USDC` → click **Redeem N.00 USDC** → approve. | Button shows `Redeeming…`, then toast `Redeem submitted · <sig>…`, and an explorer tab opens (devnet). Wallet mUSDC **+N.000000**. Winning-side tokens go to 0. The row disappears (`Nothing to redeem.`) and the Header dot clears. | [ ] Pass [ ] Fail |
| 8.4 | Losing side: switch Phantom to the **other** wallet from 7.2. | Losing tokens stay in the wallet with no Redeem row (redeem is winner-only). Position card says `Your side did not win. Payout 0.00 USDC.` if you hold only the loser. | [ ] Pass [ ] Fail |
| 8.5 | **History → Redemptions** and **Settlements**. | A `redemption · Redeem Yes` row (or `Redeem No`) with USDC `+N.00`, and a `settlement · Result: Yes` row (or `Result: No`) at the settle price. | [ ] Pass [ ] Fail |
| 8.6 | Run §11 checkpoint D (after redeem). | Vault −N raw ×10⁶. Winning supply −N ×10⁶. `pairs_redeemed` +N ×10⁶. Losing supply unchanged. | [ ] Pass [ ] Fail |
| 8.7 | If neither 7.2 nor the 1.7 fallback was possible: verify the operator's redeem tx (5 pairs, `settle-test.cjs redeem`, per staging script) in Explorer, then repeat 8.1–8.6 yourself after the Friday markets settle (Fri 2026-10-09, ≥ 3:00 PM CT + 5 min admin delay). | The operator's redeem: holder mUSDC +5.000000, vault −5,000,000 raw. | [ ] Pass [ ] Fail |

---

## 9. Settlement proof card

On main: `components/market/SettleProofCard.tsx`, `lib/settle/proof.ts`, `lib/settle/fetchProof.ts` (DLV-076, D-023). Built from the `StrikeMarket` account plus the `AdminSettled` / `Settled` event in the settle tx logs, found via `getSignaturesForAddress(market)`. No program change.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 9.1 | Short market page after 7.8. | Card titled **Settlement proof**, with a chip **Yes wins** or **No wins**. | [ ] Pass [ ] Fail |
| 9.2 | Comparison line. | `AAPL $X ≥ $300.00 → Yes wins` (or `$X < $300.00 → No wins`). It must agree with the on-chain status (Policy A). The note `On-chain outcome does not match price ≥ strike — investigate.` must **not** appear. | [ ] Pass [ ] Fail |
| 9.3 | Rows. (Shown for an `admin_settle` from 7.6. After a Pyth settle in 7.5 (a)/(b) the price reads `$X Pyth` and **Confidence** shows the Pyth confidence instead.) | **Settlement price** `$X admin fallback` · **Confidence** `n/a (admin settle)` · **Strike** `$300.00 (Yes if ≥, D-005)` · **Settled at** `Oct d, h:mm:ss PM CDT · slot N` · **Settle tx** `xxxxxxxx…xxxxxxxx ↗` · **Pyth feed id** `0x49f6b6…d55688 ↗` (AAPL feed id, SCHEMA §3.1) and `price account XXXX…XXXX ↗`. | [ ] Pass [ ] Fail |
| 9.4 | Notes under the rows. | After `admin_settle`: `Settled by admin fallback (no Pyth read; price checked against strike on-chain).` After a Pyth settle: `Pyth publish time isn't stored on-chain; settle required it within 150 slots (D-005).` (`lib/settle/proof.ts`) | [ ] Pass [ ] Fail |
| 9.5 | Click **Settle tx ↗**. | Explorer (`?cluster=devnet`) opens the same signature the operator shared in 7.5 or 7.6. | [ ] Pass [ ] Fail |
| 9.6 | Click **price account ↗** and the **Pyth feed id ↗** link. | The price account opens in devnet Explorer. The feed-id link goes to Hermes `…/v2/updates/price/latest?ids[]=0x49f6…`. It may return **401**, because Hermes has been key-gated since 2026-08-26 (DLV-085). Note what you see; a 401 is not a Meridian defect. | [ ] Pass [ ] Fail |
| 9.7 | If the RPC has pruned history. | **Settle tx** reads `not found in RPC history`, with the note `Settle transaction not found in RPC history (pruned or not yet indexed); values are from the market account.` Price, strike and time still come from the account. | [ ] Pass [ ] Fail |

---

## 10. Payoff line ("what if") and distance to strike

On main: `lib/copy/whatIf.ts`, `components/trade/DistanceReadout.tsx`, `lib/copy/payoff.ts` (DLV-075). Market orders use the live touch price; Limit orders use the price you typed. Amounts are before fees (fees are 0 on staging). Use AAPL ≥ 305, expiring Oct 9.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 10.1 | **Buy Yes · Limit · 10 @ 0.45** (don't submit). | `If AAPL closes ≥ $305.00 on Oct 9 you get $10.00 (+$5.50). If not, you lose $4.50.` | [ ] Pass [ ] Fail |
| 10.2 | **Sell Yes · Limit · 10 @ 0.45** (needs Yes held; otherwise just read the copy while the button is disabled). | `You get $4.50 now. If AAPL closes ≥ $305.00 on Oct 9 you give up $10.00 (−$5.50 vs holding). If not, they would have paid $0.00.` | [ ] Pass [ ] Fail |
| 10.3 | **Buy No · Limit · 10 @ 0.55**. | `If AAPL closes below $305.00 on Oct 9 you get $10.00 (+$4.50). If not, you lose $5.50.` | [ ] Pass [ ] Fail |
| 10.4 | **Sell No · Limit · 10 @ 0.55**. | `You get $5.50 now. If AAPL closes below $305.00 on Oct 9 you give up $10.00 (−$4.50 vs holding). If not, they would have paid $0.00.` | [ ] Pass [ ] Fail |
| 10.5 | Switch to **Market**. | The sentence recomputes at the live best price for that intent (No intents in No terms = 1 − Yes). It matches the `Market fills at best … (up to …)` line. | [ ] Pass [ ] Fail |
| 10.6 | Clear the price (Limit) or use a market with an empty book (Market). | `Enter a size and a price between 0.01 and 0.99.` / `No live price on the book for a market order yet.` | [ ] Pass [ ] Fail |
| 10.7 | Distance readout under the sentence. | `AAPL $<price> · needs +x.x%` when below the strike, `is x.x% above strike` when above, `at strike (Yes if ≥)` when equal. The leading side is tinted. Shows `AAPL — · distance to strike —` if the feed can't be decoded. Market cards show a compact version. The devnet reference feed may be minutes old: check `· Ns ago` in the header. | [ ] Pass [ ] Fail |
| 10.8 | Line under the submit button. | `Each contract pays 1.00 USDC if your side is right at settlement, and 0 if not.` | [ ] Pass [ ] Fail |

---

## 11. Invariant checks via Solana Explorer (devnet)

**What must hold** (fees are 0 on staging; TEST_MATRIX I2/I3, SCHEMA §1.3 and §7):

- **Vault:** `collateral_vault` token balance (raw, 6 dp) **==** `pairs_minted − pairs_redeemed` (raw). With fees > 0 this becomes `≥` (I3).
- **While Open:** `yes_mint` supply **==** `no_mint` supply **==** `pairs_minted` (I2). `mint` adds to all three; `merge_pair` (Sell No market) subtracts from all three. Phoenix-only trades (Buy/Sell Yes) change none of them (PHX-02/03).
- **After settle:** nothing in this list moves at settle. Each redeem burns winning tokens 1:1, so the vault also equals the **winning mint's supply**. The losing supply stays at `pairs_minted` (unless someone calls `burn_losing`).
- Raw units: 1 contract = 1 mUSDC = **1,000,000** raw. The Explorer UI shows decimals, so multiply by 10⁶.

### 11.1 Find the accounts

PDA seeds (program `9Rb7nx…`; `programs/meridian/src/constants.rs`, `instructions/create_strike_market.rs`; SCHEMA §1.2–1.3, [`accounts.md`](accounts.md)):

| Account | Seeds |
| --- | --- |
| Config | `["config"]` |
| StrikeMarket | `["strike_market", equity_symbol (8 bytes, NUL-padded), expiry_ts (i64 LE), strike_price_e6 (u64 LE)]`. This is the `marketId` in the page URL and Rules card |
| Yes mint | `["yes_mint", strike_market]` (6 dp; mint authority = vault authority) |
| No mint | `["no_mint", strike_market]` |
| Vault authority | `["vault_authority", strike_market]` |
| Collateral vault (token account) | `["collateral_vault", strike_market]` (mint = mUSDC, authority = vault authority) |

`accounts.md` still mentions a separate `yes_mint_authority` seed. The program on main uses the vault authority PDA as mint authority.

Ways to get the addresses without code (the IDL isn't published on-chain, so Explorer won't decode Meridian accounts):

1. **From a Buy No / mint tx in Explorer.** Open the tx → the instruction for program `9Rb7nx…` → account list (prod IDL order for `mint`): #3 `strike_market`, **#4 `collateral_vault`**, #5 `vault_authority`, **#9 `yes_mint`**, **#10 `no_mint`**, #11 `treasury`, #12 `collateral_mint`.
2. **From raw `StrikeMarket` data.** Absolute byte offsets (including the 8-byte discriminator), all little-endian (`state/strike_market.rs`). Bytes 0–7 are the Anchor discriminator, so these are offsets from the start of the account data, exactly as the helper below reads them:

   | Field | Offset |
   | --- | --- |
   | `strike_price_e6` | 120 (u64) |
   | `expiry_ts` | 128 (i64) |
   | `yes_mint` | 136 |
   | `no_mint` | 168 |
   | `collateral_vault` | 200 |
   | `phoenix_market` | 232 |
   | `status` | **328** (u8: 0 Open, 2 SettledYes, 3 SettledNo, 4 Void) |
   | `pairs_minted` | **329** (u64) |
   | `pairs_redeemed` | **337** (u64) |
   | `settlement_price_e6` | 345 (u64) |
   | `settled_at_ts` | 353 (i64) |
   | `settled_slot` | 361 (u64) |

   Read with `solana account <MARKET> -u devnet` (hex dump; read-only) or the snippet below.

Read-only helper (no keys; derives the PDAs, cross-checks them against the market account, prints the invariant). Run it on any machine with Node ≥ 18 and `npm i @solana/web3.js`:

```js
// node check-market.js <STRIKE_MARKET_ADDRESS>   — read-only, devnet
const { Connection, PublicKey } = require("@solana/web3.js");
const PROGRAM = new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");
const market = new PublicKey(process.argv[2]);
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const pda = (seed) => PublicKey.findProgramAddressSync([Buffer.from(seed), market.toBuffer()], PROGRAM)[0];
(async () => {
  const d = (await conn.getAccountInfo(market)).data;
  const key = (o) => new PublicKey(d.subarray(o, o + 32));
  const u64 = (o) => d.readBigUInt64LE(o);
  const yes = pda("yes_mint"), no = pda("no_mint"), vault = pda("collateral_vault");
  console.log("PDAs match account:", key(136).equals(yes), key(168).equals(no), key(200).equals(vault));
  const status = d[328], minted = u64(329), redeemed = u64(337);
  const v = BigInt((await conn.getTokenAccountBalance(vault)).value.amount);
  const ys = BigInt((await conn.getTokenSupply(yes)).value.amount);
  const ns = BigInt((await conn.getTokenSupply(no)).value.amount);
  console.log({ status, pairs_minted: minted, pairs_redeemed: redeemed, vault: v, yes_supply: ys, no_supply: ns });
  console.log("vault == minted - redeemed:", v === minted - redeemed);
  if (status === 0) console.log("Open: yes == no == minted:", ys === minted && ns === minted);
  else console.log("Settled: vault == winning supply:", v === (status === 2 ? ys : ns));
})();
```

In Explorer: the **vault** page shows **Token balance**. The **Yes / No mint** pages show **Current Supply**. Record raw values (× 10⁶).

### 11.2 Checkpoints

The maker seeded books by minting pairs at bootstrap, so record a **baseline** first and check **deltas** as well as the equality.

| # | When | Action | Expected | Pass / Fail |
| --- | --- | --- | --- | --- |
| A | Baseline / after mint | On the book market, before §3 (and the short market at 7.2b), record vault, Yes supply, No supply, `pairs_minted`, `pairs_redeemed`. Repeat right after **3.5 Buy No · Market · 5**. | Baseline: vault == Yes == No == `pairs_minted − pairs_redeemed` (`pairs_redeemed` = 0 while Open). After 3.5: vault, Yes supply, No supply and `pairs_minted` **each +5,000,000**. | [ ] Pass [ ] Fail |
| B | After trades | After 3.1–3.4 (Yes-only trades), after **3.7 Sell No · Market**, and at the end of §3–§4. | Yes-only trades: **no change** to vault, supplies or `pairs_minted`. Sell No market: each **−5,000,000** (`merge_pair`). The equalities from A still hold at the end. Cancel/withdraw (§4) move only Phoenix and wallet balances, never the vault. | [ ] Pass [ ] Fail |
| C | After settle | Short market, after 7.6. | `status` 2 or 3. Vault, supplies, `pairs_minted` and `pairs_redeemed` **identical** to before settle. vault == `pairs_minted − pairs_redeemed` == winning supply. | [ ] Pass [ ] Fail |
| D | After redeem | Short market, after 8.3 (and after the operator's redeem). | Per redeem of N: vault −N×10⁶, winning supply −N×10⁶, `pairs_redeemed` +N×10⁶. Losing supply and `pairs_minted` unchanged. vault == `pairs_minted − pairs_redeemed` == winning supply. When every winner has redeemed, vault = 0. | [ ] Pass [ ] Fail |

Any mismatch at any checkpoint is a **blocker**. Record the market address, the raw numbers, and the last tx signature.

---

## Automated coverage gaps

What this manual plan covers that automation doesn't:

- **No component tests.** The web has no jsdom/component tests. UI behaviour is covered only by pure-function unit tests (`apps/web/src/**/*.test.ts`) and the headless smoke script used in the hardening pass ([`TEST_RESULTS.md`](TEST_RESULTS.md)).
- **Opt-in E2E depends on local seed scripts.** The real-Phoenix E2E suites (`src/lib/phoenix/localnet.hardening.e2e.test.ts`, `src/lib/portfolio/localnet.account.e2e.test.ts`) run only with `LOCALNET_E2E=1`. They need `scripts/e2e/create-lifecycle-markets.ts` plus local bootstrap/seed scripts on a spare validator, and are skipped in normal `vitest` runs (the "14 skipped").
- **No CI runners on the labs host.** `.gitlab-ci.yml` defines `prod-build-no-fixtures` and `localnet-anchor-test`, but labs.gauntletai.com has no shared runners, so the jobs stay pending ([`DEPLOY.md`](DEPLOY.md) §6). Local green is the gate.
- **Nothing automated runs against devnet / Railway staging.** The staging pipeline (`ops/run-staging.sh`, `ops/settle-test.cjs`, `ops/staging.e2e.test.ts`) is in git since !73 but is an operator run, not a test suite. It dump-and-asserts the deployed program (1.1b) and pauses + settles the 20-min market, but nothing records a pass/fail outside its log. This plan is the acceptance record.
- **Admin settle and the Hermes path aren't exercised on devnet by any committed test.** `tests/prod/settle_pull_oracle.ts` runs the prod `.so` in LiteSVM with recorded account bytes; `apps/automation` unit-tests `settleWithPullOracle` with stubbed deps. 7.5 / 7.6 are the first live run.
- **No localnet test yet for orders on a paused book (Engineers flagged it as uncovered in !73).** `apps/automation/test/phoenix-pause.localnet.test.ts` (opt-in, `PHOENIX_LOCALNET_RPC`) covers the handoff, the old authority being refused, `runPausePass` pausing a real Phoenix book, a second pass being a no-op, and resume. It doesn't place an order on the paused book (expected reject), and it doesn't cancel or withdraw on it (expected success). 7.3b / 7.3c are the only check of that behaviour until such a test lands.

## Pending features and known limits on main @ 7219ac1

| Item | Where in this plan | Tracker / source |
| --- | --- | --- |
| Resting / limit **Sell No** doesn't `merge_pair` on fill. You end up holding Yes + No | 3.8 | DLV-069 (Todo) |
| History doesn't list **maker fills** by other traders against your resting orders | 5.10 | TRACKER Todo (follow-up to DLV-088) |
| Permissionless Pyth settle **isn't proven end-to-end on devnet yet**. TRACKER DLV-085 records `PYTH_HERMES_API_KEY` as set on Railway `automation`. The box pipeline needs the key in its own env, or it skips the Hermes path. The sponsored shard-0 accounts are stale (RAILWAY_STAGING §0). Outside US equity hours there may be no AAPL update within 60 s after expiry, so `admin_settle` is the fallback. Prove the pull path (7.5 (a)/(b)) before any public demo | §7 (7.5, 7.6) | DLV-085 (!73); Reviewers condition 3 |
| **M1: fractional sizes.** **Fixed in the web on main @ `dd46769`** (!67): the ticket and the order path refuse sizes that aren't whole lots before signing. The program itself still accepts any raw amount. Reviewers' condition was "M1 fixed before outside testers". The fix hasn't had a Reviewers pass yet (no review notes on !67 when this was written), so **3.11 is the acceptance check** | §3 caution, 3.11 | Reviewers M1 (!54), condition 4; !67 |
| **M2: `custom` cluster label turned fixtures on for any RPC.** **Fixed on main @ `dd46769`** (!69): fixtures need a fixture label **and** a loopback RPC. Not yet re-reviewed. Staging still runs with `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` set explicitly (Explorer links / chip), and 2.3b is the acceptance check | 1.2b, 2.1, 2.3b | Reviewers M2 (!59), condition 2; !69 |
| Operator scripts that hold authority, settler and pauser keys (`ops/devnet-bootstrap.cjs`, `ops/run-staging.sh`, `ops/settle-test.cjs`) are **committed under `ops/` since !73** (no keys or box paths). This plan hasn't confirmed a Reviewer pass on them. The box runs a synced copy, so the code that ran is whatever SHA the operator synced (ask) | 1.1b, 1.2d, 1.5, 1.7, §7 | Reviewers !65 note 4; DLV-098 (!73) |
| **Pause at expiry depends on the pauser key, the handoff and timing.** Books are paused at expiry since !73. A book stays tradeable if (a) `PHOENIX_PAUSER_KEYPAIR` is unset and the box watcher isn't running, (b) its seat-manager authority was never handed to the pauser, or (c) the pause tx fails. Between expiry and the pause landing (seconds on the box, up to a worker tick) the book is still Active. All three log `[pause] ALERT …` and retry each pass. There's no UI indicator for Paused | 1.2d, §7 box, 7.3b, 7.3c | DLV-097 (!73); review dd46769 condition 7 |
| **M4 / M5:** **fixed in the web on main @ `dd46769`** (!67), not yet re-reviewed. M4: server-side market-list cache (20 s), Header reads only settled markets' ATAs (60 s), trade account 10 s, book 6 s, History 60 s, 429 backoff (`lib/rpc/pollPolicy.ts`). M5: the balances lock fails closed (6.8). Public `api.devnet.solana.com` is still rate-limited, so with more than one or two concurrent testers expect slower refreshes, or point staging at a dedicated devnet RPC (label still `devnet`, 1.2b) | 6.7, 6.8 | Reviewers !63 M4, M5; !67 |
| **L11 / L14:** **fixed on main @ `dd46769`** (!67). The sweep is disclosed on the ticket and in the success toast (4.10, 4.11), and success toasts appear only after the tx confirms without an error. L13 (Cancel all > ~50 orders) is chunked at 20 orders per tx. Still compare balances with the toasts while testing | 4.6, 4.7, 4.10, 4.11 | Reviewers !63 L11, L13, L14; !67 |
| Program not yet on devnet (devnet SOL) | 1.1 | DLV-077 (In Progress) |

## Sign-off

| Date (CT) | Tester | Main tip SHA tested | Devnet program id | Result (Pass / Fail / Partial) | Notes / failing step #s |
| --- | --- | --- | --- | --- | --- |
| | Debu | | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` | | |
| | | | | | |

Railway redeploys from a `git archive` of main (RAILWAY_STAGING §0), so put the SHA Railway was deployed from in the tip column. If it isn't `7219ac1`, recheck any step whose UI changed since. Also note the SHA of the box's synced `ops/` copy (§ "Per staging script").

## Related

[`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) · [`DEPLOY.md`](DEPLOY.md) · [`TEST_RESULTS.md`](TEST_RESULTS.md) · [`TEST_MATRIX.md`](TEST_MATRIX.md) · [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (localnet) · [`SCHEMA.md`](SCHEMA.md) · [`ui/06-trading-intents-and-constraints.md`](ui/06-trading-intents-and-constraints.md) · [`DECISIONS.md`](DECISIONS.md) (D-005, D-018, D-021, D-023, D-024, D-025)
