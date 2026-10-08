# Meridian devnet staging acceptance test plan (Phantom)

| Field | Value |
| --- | --- |
| **Owner** | Meridian Testers |
| **Tester** | Debu (manual, Phantom on devnet) |
| **App under test** | Railway staging web: https://web-production-77fbb.up.railway.app ([`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) §0) |
| **Cluster** | Solana **devnet** (`https://api.devnet.solana.com`) |
| **Program id** | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` (prod build, no `localnet-test` features; [`DEPLOY.md`](DEPLOY.md) §3, `apps/web/src/lib/solana/config.ts` `DEFAULT_PROGRAM_ID`) |
| **Written against main tip** | `6e3c91b` (`6e3c91bc41115d32da9c4754a7ad0411181c96dc`, Merge !69). First written at `0d856ed` (!65), revised at `ea84698` (!66), then re-checked after two Engineers' web fixes landed while this MR was open: !67 (`7aa1fe5`, Reviewers M1/M4/M5 + L8/L10–L14) and !69 (`6e3c91b`, M2: fixtures need a loopback RPC). Program, IDL and automation are unchanged since `0d856ed`. The separate settler key (M3) is in open MR !70: **pending feature: not on main @ 6e3c91b** |
| **Revision** | Reviewer fixes from the Meridian Reviewers' !63/!65 review (MR !65 notes, items 1–8): deployed-binary check (1.1b), explicit `devnet` cluster (1.2b, 2.1; M2 fixed by !69), 404 checks (2.3b, 2.4b), whole-contract caution (§3), sweep and atomicity checks (4.9–4.11), M1/M5 checks (3.11, 6.8; both fixed by !67), post-expiry window (§7 box, 7.3b), §11.1 offsets wording, Reviewer conditions in the known-limits table. Also updated for the staging script's 20-min market **with** a Phoenix book and a funded wallet B (1.5, 1.7, §7) |
| **Status** | Ready to run **once the prod `.so` is deployed to devnet and the staging markets are bootstrapped** (DLV-077 is In Progress, blocked on devnet SOL) |

Use this checklist once the program is on devnet. Each step has an **Action**, the **Expected result** on main @ `6e3c91b`, and a **Pass / Fail** box. Steps that depend on a feature that is not on main are marked **pending feature: not on main @ 6e3c91b**. Steps that need the operator (someone with the staging keys on the ops box) are marked **[operator]**.

**Not covered here:** deploying, Railway changes, local validators. This plan is read-and-click only for Debu (plus two read-only `curl -I` checks in §2). The operator steps are listed so you know what to ask for and when.

**"Per staging script"** means the box-only ops pipeline `run-staging.sh` + `devnet-bootstrap.cjs` (revision of 2026-10-07 ~23:25 CT). These scripts are **not in git at `6e3c91b`**, so the repo can't confirm them. Each step that relies on them has a **fallback** line for a run where the script doesn't do it. The Reviewers asked for these scripts to be committed (without keys) or reviewed before outside testers (see Known limits).

---

## 0. Staging facts used by this plan

Sources: [`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) §0, [`DEPLOY.md`](DEPLOY.md), program source under `programs/meridian/src/`.

| Item | Value | Source |
| --- | --- | --- |
| Collateral | Staging test mint **mUSDC** `GEBRsT3Nc3PaEio2qf3x4JUgFtPSYXr7bmVitMuzMBXq`, 6 decimals. Mint authority is a box-only admin key, so only the operator can mint it | RAILWAY_STAGING §0 |
| Config params | Fees **0 / 0 bps**, `settle_max_staleness_slots` 150, `settle_max_conf_ratio_bps` 200, **`admin_settle_delay_secs` 300** (staging only) | RAILWAY_STAGING §0 |
| Config authority / keeper | `CCt1MZ5GPYskDBjSDfknkamesGufsJFk2yFzXNvV5dst`. Only this key can `admin_settle`. It is a Railway secret / ops-box key, not in Phantom. The **same key also acts as keeper/settler**: there's no separate settler key yet (Reviewers **M3**, see Known limits) | RAILWAY_STAGING §0, `instructions/admin_settle.rs` (`has_one = authority`), `apps/automation/src/modes/calendar.ts` (`settler: opts.authority`) |
| Phoenix | V1 `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY` + Seat Manager. Yes/USDC books, tick $0.01, 1 lot = 1 contract, 0 bps. Any wallet can claim a seat (the app does it on your first order) | RAILWAY_STAGING §0, D-015 |
| Markets (planned) | AAPL ≥ 305, NVDA ≥ 210, TSLA ≥ 365, MSFT ≥ 495, all expiring **Fri 2026-10-09 16:00 ET (3:00 PM CT)**. Phoenix books on the first 1–3, depending on SOL | RAILWAY_STAGING §0 |
| Short settle-check market | **AAPL ≥ 300**. Per staging script it's created **on your START signal** (not at bootstrap), **with a Phoenix Yes/mUSDC book**: the maker mints 3,000 pairs and posts a 5-level ladder around fair 0.50 (asks 0.51 / 0.53 / 0.55 / 0.57 / 0.59, bids 0.49 / 0.47 / 0.45 / 0.43 / 0.41, sizes 100…500). Expiry = chain time at START + 20 min + 180 s setup, so ≥ 20 min of trading remain after the log line `SHORT MARKET READY`. **Fallback:** a run without the book behaves as in §7's fallback note | Per staging script (`run-staging.sh` header, `devnet-bootstrap.cjs` `SHORT_BOOK=1`, `SHORT_MIN=20`, `SHORT_SETUP_SECS=180`); RAILWAY_STAGING §0 |
| Wallet B (counterparty) | Per staging script: funded at bootstrap with **0.5 SOL** (devnet faucet airdrop; payer transfer only if the faucet refuses) + **1,000 mUSDC** (admin `mint_to`). It's either the box keypair `wallet-b.json` (import into Phantom) or, with `WALLET_B=<pubkey>`, your own second Phantom address. **Fallback:** ask the operator to fund it by hand | Per staging script (`devnet-bootstrap.cjs` step 1c, `WALLET_B_SOL` 0.5, `WALLET_B_USDC` 1000) |
| Web cluster | `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`, set **explicitly**, and never `custom` on staging. Reviewers **M2** is fixed on main by !69: a fixture-style label (`localnet` / `localhost` / `custom`) now enables fixture markets, the fixture book, fixture slugs and the demo portfolio **only with a loopback** `NEXT_PUBLIC_SOLANA_RPC_URL` (`isFixtureCluster(cluster, rpcUrl)`). `custom` is still wrong for staging: Explorer links become `?cluster=custom&customUrl=…` (`explorerClusterQuery`), the chip shows `custom`, and the Reviewers' condition stands until they re-review. The app has **no URL parameter** for the cluster. The label comes only from this env var (default `devnet`) and is baked in at build time | `apps/web/src/lib/solana/config.ts` (`getCluster`, `fixturesAllowed`), `lib/market/marketIdRoute.ts` (`FIXTURE_CLUSTERS`, `isFixtureCluster`, `LOOPBACK_RPC`), `apps/web/.env.railway.staging.example`; per staging script `pin_web_cluster` (`WEB_CLUSTER=devnet  # never custom`) |
| Settlement until the Hermes key exists | `admin_settle` with a Policy A–consistent price after `expiry + admin_settle_delay_secs`. Permissionless settle needs `PYTH_HERMES_API_KEY` (DLV-085, Todo) | D-018, D-025, RAILWAY_STAGING §0, DEPLOY §4 |
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
| 1.3 | Phantom → Settings → Developer Settings → turn on **Testnet Mode** and choose **Solana Devnet**. | Phantom shows devnet balances. Transactions from the app are simulated against devnet. | [ ] Pass [ ] Fail |
| 1.4 | Check wallet A (your main Phantom account) balances. | **≥ 1 SOL** (the bootstrap sends ~2 SOL to your wallet; RAILWAY_STAGING §0) and an **mUSDC** balance (unknown-token row, mint `GEBRsT3N…MXq`). If either is missing, ask the operator: public devnet airdrops are rate-limited (429), and only the operator can mint mUSDC. | [ ] Pass [ ] Fail |
| 1.5 | Set up **wallet B** (a second Phantom account) for counterparty fills (§4) and the other side of the 20-min market (§7). Per staging script, wallet B is **funded at bootstrap** with 0.5 SOL + 1,000 mUSDC. Either give the operator your second Phantom address **before bootstrap** (`WALLET_B=<pubkey>`), or import the box keypair `wallet-b.json` that the operator gives you (devnet test key only). **Fallback** (the run log shows `wallet B: skipped`, or `WARNING wallet B has … SOL`): ask the operator to send ~0.5 SOL and ~1,000 mUSDC by hand. | Wallet B shows **≥ ~0.5 SOL** and **1,000 mUSDC** (mint `GEBRsT3N…MXq`) on devnet. The SOL covers the Phoenix seat claim and token accounts on its first order. | [ ] Pass [ ] Fail |
| 1.6 | **[operator]** Ask for the bootstrap summary: the Friday market addresses and which have Phoenix books, wallet B's pubkey, and the 1.1b / 1.2b log lines. | You have the market list, know which markets have books, and have wallet B's address. | [ ] Pass [ ] Fail |
| 1.7 | **[operator]** Start the 20-min AAPL ≥ 300 market when you're ready (§3–§6 done, ~30 min free). Per staging script the operator does this with `touch /workspace/meridian-staging-ops/START_20M` on the ops box (or `bash run-staging.sh --start-20m-now`). The market gets a Phoenix book + maker ladder, so you **trade it yourself in the UI** (§7). Ask for the `SHORT MARKET READY` line: market address, `phoenix=<pubkey>`, and the trade-until time (CT). | Log `SHORT MARKET READY: AAPL >= 300 — trade until <time CT> (~20+ min left; UI closes 5 s early); admin_settle >= <expiry + 5 min>, pipeline settles + redeems ~<expiry + 5½ min>`. The market's Rules card ends `· phoenix <pubkey>` (not `phoenix unset`). **Fallback** (the script at your run doesn't add the book: the READY line shows `phoenix=none`, the ticket reads `Phoenix not configured — Buy Yes`, or the Rules card says `phoenix unset`): before expiry, ask the operator to transfer N Yes **and** N No of the short market to wallet A (off-book SPL transfer; vault and `pairs_*` don't move, V-08). Without either, §8 can only be checked on the operator's own redeem tx (8.7). | [ ] Pass [ ] Fail |

> **Timing (per staging script):** the short market isn't created at bootstrap. It waits up to 24 h for your START signal (1.7). After START: book + ladder setup (~3 min), then ≥ 20 min of trading. At expiry + ~5½ min (`admin_settle_delay_secs` 300 + 30 s margin) the pipeline tries a permissionless Pyth settle, falls back to `admin_settle` at the last published AAPL Pyth price, and redeems the operator's own 5 test pairs. **Fallback** (older script without the START wait): the short market appears ~20 min after bootstrap, so be at your desk from bootstrap on.

---

## 2. Connect wallet on devnet

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 2.1 | Open `https://web-production-77fbb.up.railway.app/markets`. | Header shows **Markets / Portfolio / History**, a cluster chip reading exactly **devnet** (title `Solana cluster`; it prints `NEXT_PUBLIC_SOLANA_CLUSTER`, `components/layout/Header.tsx`), and a wallet button. A chip reading **`custom`** (or `localnet`) is a **FAIL**: wrong config. On main @ `6e3c91b` fixtures stay off with a non-loopback RPC (M2 fix, !69), but stop and report it (and on an older Railway SHA, fixtures **would** be live). There's no banner "You're connected to the wrong cluster…" (`components/layout/GlobalBanners.tsx`; it only compares the label with the RPC URL, `lib/solana/banners.ts`, and can't see Phantom's network, so 1.3 still matters). | [ ] Pass [ ] Fail |
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

> **Whole contracts only.** Every size in this plan is a whole number of contracts (1 lot = 1 contract on staging). Don't type fractions. What the code does with a fractional size on main @ `6e3c91b` (Reviewers **M1** fix, !67):
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
| 3.8 | **Sell No · Limit · 5** at a crossing No price → `Sell No 5 @ 0.xx`. | Ticket shows `Sell No (resting): bid Yes only — merge_pair on fill not automatic yet.` Toast includes the caveat `Sell No resting orders place Bid Yes at 1−p_no only. merge_pair on fill is not automatic yet…`. The bid fills, so you now hold **Yes 5 + No 5**, and the Position card reads **"Both sides held"**. **Automatic merge on fill: pending feature: not on main @ 6e3c91b (DLV-069).** Pass = the behavior above. | [ ] Pass [ ] Fail |
| 3.9 | Unwind 3.8: **Sell Yes · Market · 5**, then **Sell No · Market · 5**. | Flat again: **"No position."** | [ ] Pass [ ] Fail |
| 3.10 | Negative check (D-024): **Buy Yes · Market** with a size larger than the visible ask depth (e.g. 100000). | Error toast `No fill: the book doesn't have 100000 Yes at 0.xx or better. Nothing was traded — try a smaller size or a Limit order.` (`lib/phoenix/errors.ts`). No balance change. Phantom may warn that the simulation fails. Rejecting it there also passes, and the toast is then `Wallet rejected the transaction.` The same check with free seat funds is 4.10. | [ ] Pass [ ] Fail |
| 3.11 | M1 regression: on **Buy No · Market**, type size **2.5**. Then try **0.5** and **Sell No · Market · 2.5**. | Each time, the inline error `Size must be a whole number of contracts.` appears under the size box and the **Buy No / Sell No button is disabled**, so Phantom never opens (`lotSizeError`, !67). If Phantom **does** open, **reject it** and record **FAIL**: Railway is probably on a SHA before !67. | [ ] Pass [ ] Fail |

---

## 4. Resting limit filled by wallet B, then cancel and withdraw (DLV-087)

On main via !63 (`components/portfolio/PhoenixActions.tsx`, `lib/phoenix/manage.ts`, `components/trade/PositionPanel.tsx`). Maker fills land in your **Phoenix trader account (seat)**, not your wallet.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 4.1 | Wallet A, flat: **Buy Yes · Limit · 10** at a price **between** best bid and best ask. Per staging script the maker ladder is fair ± 0.01, so this is the one tick in the middle, e.g. **0.50** on a 0.49 / 0.51 book. Scale the USDC amounts below to your price. | Toast `Submitted phoenix-only (bid Yes @ 0.50 × 10)…`. Within ~6 s (book poll, `pollPolicy.ts` `tradeBook`) the book shows a new bid level of 10 at 0.50. **Open orders (1)** lists `Buy Yes · 0.50 · 10 · [Cancel]` with the note `Resting buys count toward the one-side rule. Cancelling returns funds to your wallet.` Wallet mUSDC drops by 5.00 (locked in Phoenix). | [ ] Pass [ ] Fail |
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
| 5.10 | Known gap: look for wallet B's fill of your resting bid (from 4.3) in **wallet A's** History. | It is **not** listed as a fill. It shows up only through your later withdraw/cancel row and the seat balance. **Maker-fill rows in History: pending feature: not on main @ 6e3c91b** (TRACKER Todo, follow-up to DLV-088). Pass = the behavior above. | [ ] Pass [ ] Fail |

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

## 7. 20-minute AAPL market: trade, close, then admin settle (no Hermes key)

Market: **AAPL ≥ 300**, created on your START signal (1.7). Per staging script it has a **Phoenix book** (maker ladder around 0.50), so the normal ticket works on it. The Rules card ends `· phoenix <pubkey>`. **Fallback** (a run without the book): the ticket CTA reads **`Phoenix not configured — Buy Yes`**, the Rules card ends `· phoenix unset` (`lib/indexer/mapStrikeMarket.ts` `phoenixOrUndefined`, `lib/phoenix/config.ts`), and you use the operator token transfer from 1.7 instead of 7.2.

How settlement works today:

- **Permissionless settle** reads a Pyth pull-oracle `PriceUpdateV2` (D-025). The automation posts it from Hermes, which needs `PYTH_HERMES_API_KEY` (DLV-085, not configured). Without it, automation logs `needsApiKey: true`.
- The calendar worker only runs settle passes at or after 16:00 ET (`apps/automation/src/schedule.ts` `assertSettleAllowedCalendar`). Its own `admin_settle` fallback needs a fixed `ADMIN_SETTLE_PRICE_E6` env (`apps/automation/src/modes/calendar.ts`). So for the short market, **the operator runs `admin_settle`** (box script `settle-test.cjs settle`, not in git), signed by the config authority (no separate settler key yet, M3).
- **`admin_settle` rules** (`programs/meridian/src/instructions/admin_settle.rs`):
  - signer must be the Config authority (`Unauthorized` 6012);
  - market must be Open (`MarketNotOpen` 6001);
  - chain time must be ≥ `expiry_ts + admin_settle_delay_secs` (300 s on staging), else `AdminSettleTooEarly` (6011 / `0x177b`);
  - price > 0;
  - **Policy A**: `outcome_yes` must equal `price ≥ strike`, else `OutcomeInconsistent` (6022).
- The UI timeline comes from `lib/market/countdown.ts` (close = settle = `expiry_ts`; trading disabled 5 s early).

> **Phoenix books stay tradeable between expiry and settle (known limit, must be fixed before mainnet).** The UI ticket turns into "Trading closed" 5 s before expiry, but that's a UI cutoff only.
> - Meridian doesn't pause or close the Phoenix market, and neither the repo nor the staging script cancels or closes it at expiry. The Yes/mUSDC book stays live on-chain until someone acts: through settle (≥ 5 min here, 30 min by default) and after it.
> - By then the expiry price is public, so **any Phoenix client** can pick off resting orders: yours and the maker ladder.
> - On-chain after expiry: `mint` fails (`MintAfterExpiry` 6004, so no Buy No), `merge_pair` still works while Open (MP-02), and plain Phoenix Yes trades still work.
>
> **What to do:**
> - **Cancel all your resting orders on the short market before expiry.** Between expiry and settle the market is still Open on-chain. The trade page's Open orders tab and its **Cancel** buttons stay available after the ticket closes, because they aren't gated on the countdown (`app/markets/[marketId]/TradeClient.tsx`, `CancelOrdersButton`). After settle the trade page stops reading Phoenix for that market (M4 poll policy, `lib/rpc/pollPolicy.ts` `accountRefsFor`), so use **Portfolio → Open orders / Phoenix balances**, which still read settled markets' seats.
> - **Don't trade the short market from other Phoenix UIs or scripts between expiry and settle.** If you see fills on it after expiry, record them under 7.3b. They're the known limit, not a Meridian program defect.
> - After settle the trade page hides the book (Settlement proof card instead), but it still exists on-chain.

| # | Action | Expected result | Pass / Fail |
| --- | --- | --- | --- |
| 7.1 | Open the short market page **before** expiry. | Countdown `Closes in mm:ss` (amber while under 1 h). Underlying line `AAPL $… · Pyth`. Order book with the maker ladder (best bid 0.49 / best ask 0.51 per staging script). Ticket with **Buy Yes / Sell Yes / Buy No / Sell No**. | [ ] Pass [ ] Fail |
| 7.2 | Take **both** sides so one of your wallets wins: wallet A **Buy Yes · Market · 5**, wallet B **Buy No · Market · 5** (whole contracts). | A: Position **Yes 5**. B: Position **No 5** (`mint-then-phoenix` toast as in 3.5). **Fallback** (no book): the operator transfer from 1.7 instead. | [ ] Pass [ ] Fail |
| 7.2b | **[operator]** Run §11 checkpoint A on this market (after the maker's 3,000-pair mint, the operator's 5-pair mint and B's Buy No). | Vault == Yes supply == No supply == `pairs_minted`. | [ ] Pass [ ] Fail |
| 7.3 | Watch through expiry, reloading the page. | About 5 s before expiry the ticket turns into **"Trading closed"** with `Redeem winning positions from Portfolio after settlement.` After expiry the countdown reads **`Resolving with Pyth…`**. The page stays like this while the market is Open on-chain: no settlement proof yet, chart stub and book **still visible**, because the book is still live (see the known-limit box above). | [ ] Pass [ ] Fail |
| 7.3b | (Optional, shows the known limit) Before expiry, wallet A places **Buy Yes · Limit · 1 @ 0.45** (rests below the ladder). Leave it through expiry, then after expiry open the **Open orders** tab and click **Cancel** → approve. | After expiry the order is still listed in Open orders and on the book: **still live on-chain**. Cancel succeeds (`Cancelled 1 order; funds returned to your wallet.`) and mUSDC +0.45. Note any fills that hit it after expiry (= picked off). | [ ] Pass [ ] Fail |
| 7.4 | **[operator]** Before `expiry + 300 s`: try `admin_settle`. (Optional; proves the delay.) | Tx fails with `AdminSettleTooEarly` (custom error `0x177b`). Market stays Open. | [ ] Pass [ ] Fail |
| 7.5 | **[operator]** (Optional) permissionless `settle` with the stored Pyth reference account. Per staging script the pipeline tries this first. | Fails, e.g. `InvalidPythAccount` (6005), `StalePythPrice` (6006) or `PythPriceNotAtExpiry` (6024). No expiry price has been posted, because there's no Hermes key. Market stays Open. | [ ] Pass [ ] Fail |
| 7.6 | **[operator]** After `expiry + 300 s`: `admin_settle(price_e6, outcome_yes)` with `outcome_yes = price_e6 ≥ 300_000_000`. Per staging script, `price_e6` = the last published AAPL Pyth price, at ~expiry + 5½ min. Share the tx signature. | Tx succeeds. The explorer log shows an `AdminSettled` event. Market `status` = 2 (SettledYes) or 3 (SettledNo). `settlement_price_e6`, `settled_at_ts` and `settled_slot` are set. | [ ] Pass [ ] Fail |
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
| 9.3 | Rows. | **Settlement price** `$X admin fallback` · **Confidence** `n/a (admin settle)` · **Strike** `$300.00 (Yes if ≥, D-005)` · **Settled at** `Oct d, h:mm:ss PM CDT · slot N` · **Settle tx** `xxxxxxxx…xxxxxxxx ↗` · **Pyth feed id** `0x49f6b6…d55688 ↗` (AAPL feed id, SCHEMA §3.1) and `price account XXXX…XXXX ↗`. | [ ] Pass [ ] Fail |
| 9.4 | Notes under the rows. | `Settled by admin fallback (no Pyth read; price checked against strike on-chain).` | [ ] Pass [ ] Fail |
| 9.5 | Click **Settle tx ↗**. | Explorer (`?cluster=devnet`) opens the same signature the operator shared in 7.6. | [ ] Pass [ ] Fail |
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
- **Nothing automated runs against devnet / Railway staging.** The box-only `staging.e2e.test.ts` / `settle-test.cjs` are ops scripts outside git. Per staging script, `run-staging.sh` dump-and-asserts the deployed program (1.1b), but that's also outside git. This plan is the acceptance record.
- **Admin settle and the Hermes path aren't exercised on devnet by any committed test.** `tests/prod/settle_pull_oracle.ts` runs the prod `.so` in LiteSVM with recorded account bytes.

## Pending features and known limits on main @ 6e3c91b

| Item | Where in this plan | Tracker / source |
| --- | --- | --- |
| Resting / limit **Sell No** doesn't `merge_pair` on fill. You end up holding Yes + No | 3.8 | DLV-069 (Todo) |
| History doesn't list **maker fills** by other traders against your resting orders | 5.10 | TRACKER Todo (follow-up to DLV-088) |
| Permissionless Pyth settle on devnet needs the **Hermes API key**. Until then it's `admin_settle` by the operator. The pull oracle isn't proven end-to-end on devnet yet; do that before any public demo | §7 (7.5, 7.6) | DLV-085 (Todo, needs Debu); Reviewers condition 3 |
| **M1: fractional sizes.** **Fixed in the web on main @ `6e3c91b`** (!67): the ticket and the order path refuse sizes that aren't whole lots before signing. The program itself still accepts any raw amount. Reviewers' condition was "M1 fixed before outside testers". The fix hasn't had a Reviewers pass yet (no review notes on !67 when this was written), so **3.11 is the acceptance check** | §3 caution, 3.11 | Reviewers M1 (!54), condition 4; !67 |
| **M2: `custom` cluster label turned fixtures on for any RPC.** **Fixed on main @ `6e3c91b`** (!69): fixtures need a fixture label **and** a loopback RPC. Not yet re-reviewed. Staging still runs with `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` set explicitly (Explorer links / chip), and 2.3b is the acceptance check | 1.2b, 2.1, 2.3b | Reviewers M2 (!59), condition 2; !69 |
| **M3: the config authority is also the keeper/settler.** There's no separate settler key yet: `CCt1…` signs `admin_settle` and the automation's settle (`calendar.ts` `settler: opts.authority`), and sits as a Railway secret / on the ops box. Acceptable for devnet with test mUSDC. **Separate settler key required before automation holds a funded or mainnet authority; must not carry to mainnet.** Fix in open MR !70 (`fix/settler-key-m3`): **pending feature: not on main @ 6e3c91b** | §0, §7 | Reviewers M3 (!57), condition 5; !70 (open) |
| Box-only ops scripts that hold authority keys and run `admin_settle` (`devnet-bootstrap.cjs`, `run-staging.sh`, `settle-test.cjs`) are **not in git** and haven't been reviewed. The "per staging script" steps (1.1b log line, 1.5, 1.7, §7) depend on them. **Commit them (no keys) or get them reviewed before outside testers** | 1.1b, 1.5, 1.7, §7 | Reviewers !65 note 4 |
| **Post-expiry trading window:** Phoenix books stay live on-chain after expiry until someone acts, including through settle. The UI cutoff doesn't stop other Phoenix clients. No cancel/close-at-expiry step exists in the repo or the staging script. **Must be fixed before mainnet** | §7 known-limit box, 7.3, 7.3b | Reviewers !65 note 7 |
| **M4 / M5:** **fixed in the web on main @ `6e3c91b`** (!67), not yet re-reviewed. M4: server-side market-list cache (20 s), Header reads only settled markets' ATAs (60 s), trade account 10 s, book 6 s, History 60 s, 429 backoff (`lib/rpc/pollPolicy.ts`). M5: the balances lock fails closed (6.8). Public `api.devnet.solana.com` is still rate-limited, so with more than one or two concurrent testers expect slower refreshes, or point staging at a dedicated devnet RPC (label still `devnet`, 1.2b) | 6.7, 6.8 | Reviewers !63 M4, M5; !67 |
| **L11 / L14:** **fixed on main @ `6e3c91b`** (!67). The sweep is disclosed on the ticket and in the success toast (4.10, 4.11), and success toasts appear only after the tx confirms without an error. L13 (Cancel all > ~50 orders) is chunked at 20 orders per tx. Still compare balances with the toasts while testing | 4.6, 4.7, 4.10, 4.11 | Reviewers !63 L11, L13, L14; !67 |
| Program not yet on devnet (devnet SOL) | 1.1 | DLV-077 (In Progress) |

## Sign-off

| Date (CT) | Tester | Main tip SHA tested | Devnet program id | Result (Pass / Fail / Partial) | Notes / failing step #s |
| --- | --- | --- | --- | --- | --- |
| | Debu | | `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` | | |
| | | | | | |

Railway redeploys from a `git archive` of main (RAILWAY_STAGING §0), so put the SHA Railway was deployed from in the tip column. If it isn't `6e3c91b`, recheck any step whose UI changed since.

## Related

[`RAILWAY_STAGING.md`](RAILWAY_STAGING.md) · [`DEPLOY.md`](DEPLOY.md) · [`TEST_RESULTS.md`](TEST_RESULTS.md) · [`TEST_MATRIX.md`](TEST_MATRIX.md) · [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) (localnet) · [`SCHEMA.md`](SCHEMA.md) · [`ui/06-trading-intents-and-constraints.md`](ui/06-trading-intents-and-constraints.md) · [`DECISIONS.md`](DECISIONS.md) (D-005, D-018, D-021, D-023, D-024, D-025)
