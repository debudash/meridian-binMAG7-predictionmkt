## 2026-10-08T09:30:00-05:00 — Engineers: per-book resilient Phoenix quotes on market cards + both-sides position badge

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/per-book-quotes-both-sides-badge` from `origin/main` @ `81e79db` |
| **Source** | Track A local smoke @ `6d04b00` (Grok Bot relay): every market card showed Yes — / No — because the settled NVDA ≥ 135 markets point at Phoenix book `6QWeT6Fp…`, which does not exist on :8899; `Client.createWithoutConfig` threw "Unable to get account data" for the whole batch (`[chain-read] rpc.phoenix.markets failed {"count":10}`). A wallet holding both sides only saw `You: Yes 10`. |
| **Decision** | Read books directly instead of through the SDK client: one `getMultipleAccountsInfo([...books, Clock])` per ≤ 99 books (100-key RPC cap), decode each with `MarketState.load` + `getUiLadder(1, clock.slot, clock.unixTimestamp)` (same clock-aware ladder the client used) inside its own try/catch. A missing / undecodable book is logged against its own address and leaves only that card unset; a settled card keeps its settlement mid. Chunk-level RPC failure or a missing Clock blanks only that chunk. Badge: `You: Yes N` / `You: No N` per docs/ui/02-markets.md; both sides → `You: Yes N · No M` with the amber chip used for "Both sides held". |
| **Change** | New `apps/web/src/lib/indexer/phoenixQuotes.ts` (`attachPhoenixQuotes`, `decodeClockSysvar`); `rpc.ts` uses it; new `lib/market/positionBadge.ts`; `MarketCard.tsx` renders it (`data-testid="position-badge"`). |
| **Tests** | Red first: `phoenixQuotes.test.ts` (8: one missing + one bad + two good books → only the bad ones blank, one batched read, per-book logs, settled mid kept, clock passed, RPC failure, non-pubkey skip, chunking) and `positionBadge.test.ts` (7). Web vitest **363 passing + 14 skipped**, `tsc` + lint clean. Read-only live check against :8899: 8 open books quoted, the two settled NVDA ≥ 135 cards keep 1 / 0 with one `rpc.phoenix.market` log line. |
| **Related** | DLV-107 · DLV-108 · DLV-090 · Track A |

---

## 2026-10-08T09:30:00-05:00 — Engineers: M1 design note — a Meridian PDA as the Phoenix Seat Manager authority (docs only)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `docs/m1-pause-pda-authority` from `origin/main` @ `6d0a2a0` |
| **Source** | `/workspace/meridian-review-mr72-73.md` M1 (mainnet gate): the hot pauser is the full PSM authority (unpause, 6/9/11, 9 → Phoenix 101 escape). Debu: design note only, no program change. |
| **Decision** | Proposed: a per-StrikeMarket PDA `[b"book_pauser", strike_market]` becomes the PSM authority. Permissionless `pause_book` is valid only when `now ≥ expiry_ts`, always CPIs PSM 8 with the constant `Paused` (idempotent no-op if already Paused/Closed), and is bound to `strike_market.phoenix_market`. Authority-gated `claim_book_pauser` (PSM 7 with PDA seeds) is used only to accept a handoff named by PSM 6. No instruction can sign PSM 6/9/11, eviction or fee changes, so Railway holds no book authority. Covers migration (hot pauser → 6 + claim), open Reviewer calls (strict expiry vs constant lead; per-market vs global PDA) and a test plan. |
| **Change** | New `docs/design/phoenix-pause-pda-authority.md`; TRACKER Todo DLV-105. |
| **Tests** | Docs only. Automation suite re-run unchanged (93 passing + 11 pending). |
| **Related** | DLV-105 · DLV-097 · DLV-102 · DLV-104 · review mr72-73 M1 |

---

## 2026-10-08T09:20:00-05:00 — Engineers: pause monitoring M2 + review mr72-73 Lows 1/2/3/5/6/7, pauser-powers docs, pauser rotation runbook (open MR for Reviewers, not merged)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/pause-monitoring-m2-lows` from `origin/main` @ `6d0a2a0` |
| **Source** | `/workspace/meridian-review-mr72-73.md` M2, Lows 1, 2, 3, 5, 6, 7, the rate-limit nit, and the "pauser = full seat-manager authority" doc finding. Debu: open the fix MR and send it to Meridian Reviewers **before** merge. |
| **Decision** | The pauser keeps watching **every** book (no permanent "done" skip): each pass re-reads status, Phoenix market authority (header @208) and the seat-manager authority. A book that went Active again after a pause is re-paused with `[pause] ALERT`; authority drift (SM authority no longer the pauser, market authority no longer the SM PDA) alerts, rate-limited per key (1 h). A failed list/read pass alerts when books are due instead of rejecting silently. Worker passes run serially. Pause lead / alert values outside a sane range fail start-up. The pauser key must differ from the keeper / settler / seat-manager authority keys. Docs no longer call the pauser "pause-only": it is the full PSM authority (any status incl. unpause, successor naming 6/9, renounce 11). Rotation and an offline backup are in a runbook; keys are never committed, paths come from env. Low 4 skipped (config-only; done by the Railway var in !77). M1 (PDA authority) is a separate design note. |
| **Change** | `apps/automation/src/phoenix/pauseAtExpiry.ts` (`PauseMemory`, `runPausePass` re-check + re-pause + authority alerts + `passError`, `serialRunner`, per-book decode errors, 240-byte header slice), `seatManager.ts` (`decodePhoenixMarketHeader`, full-powers header comment), `worker.ts`, `config.ts` (`intInRange`, `assertPauserDistinct`), `ops-cli.ts` (pause-watch keeps monitoring to `--max-hours`; `--exit-when-paused`; pause-once exits 1 on failure); `ops/run-staging.sh` (devnet genesis assert, `mktemp -d` run dir, no `/tmp` literals, `$STATE` as argv to python, keeper/pauser distinct env, mint/pause ALERTs, Railway tokens unset); web `readAccount.ts` / `pollPolicy.ts` (`phoenixReadFailed` keeps polling instead of treating a failed read as an empty seat); docs ops/README (M2 monitoring), STAGING_TEST_PLAN, DEPLOY, RAILWAY_STAGING, VISUAL_RUNBOOK; new `docs/runbooks/PAUSER_ROTATION.md`. |
| **Tests** | Red first: `test/pause-monitoring.test.ts` (M2, L1, L2, L3, L5, L6, docs, runbook) → automation **125 passing + 12 pending**, `tsc` clean. Opt-in localnet Phoenix suite on a temporary `:8699` validator **12/12** (new: header authority = SM PDA; a book set Active again is re-paused + ALERTed). Web vitest **350 passed + 14 skipped**, `tsc` clean. |
| **Related** | DLV-104 · DLV-097 · DLV-102 · DLV-105 (M1 design note) · review mr72-73 M2 / L1–L3 / L5–L7 |

---

## 2026-10-08T09:10:00-05:00 — Engineers: staging gates from review mr72-73 (M3 admin_settle price never stale; handoff repair for every book; pause lead 5 s)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/staging-gates-m3` from `origin/main` @ `0f303de` |
| **Source** | `/workspace/meridian-review-mr72-73.md` "Debu-only devnet staging: OK to proceed if" 1–3: M3 (the `run-staging.sh` admin_settle fallback used the ~55-day-old `pyth-read.py` shard-0 price, so the 20-min AAPL ≥ 300 outcome was fixed in advance), every book (incl. pre-!73 Friday books) on the pauser with `pause-status` showing it, `PHOENIX_PAUSE_LEAD_SECS=5` (L4). |
| **Decision** | Option (a)+(b) of M3: fallback = the Hermes price **at expiry** (same `/v2/updates/price/{expiry}` route as pull settle), accepted only for the market feed, `|publish_time − expiry| ≤ 600 s`, price > 0, conf ≤ the config cap. Otherwise **refuse** (`[settle] ALERT`) and wait for an operator price that must carry its **source** and be **bound to the market** (so a leftover value can't settle another market); a valid Hermes price always wins. `pyth-read.py` is informational only, with an age guard. Handoff: idempotent repair over the whole state after each bootstrap phase + a key-less `--expect-pauser` gate. |
| **Change** | `apps/automation/src/pyth/adminFallback.ts` (`decideAdminFallbackPrice`, `priceToE6`); `src/phoenix/handoff.ts` (`planHandoff` refuses pauser == current authority, `authorityReport`); `ops-cli.ts` (`admin-price` read-only, `pause-status --expect-pauser` → `[pause] ALERT` + exit 2, `handoff` via the planner with ALERT + exit 2 on foreign/failed, missing state = 0 books); `pyth/hermes.ts` (403 "Not entitled" named as a missing feed entitlement, not a bad key); `ops/run-staging.sh` (`handoff_repair` after phase 1 and phase 2 and in `DRY_RUN`, `admin_price` + `$ADMIN_PRICE_FILE` operator path, `mktemp` settle log, `AUTO` overridable); `ops/settle-test.cjs` + `ops/lib/admin-price.cjs` (no `ADMIN_PRICE_E6` without `ADMIN_PRICE_SOURCE`); `ops/pyth-read.py` (age guard, exit 2 on stale); docs (STAGING_TEST_PLAN 7.6 / settle chain, VISUAL_RUNBOOK 14, ops/README, DEPLOY, env examples lead 5). |
| **Finding** | Live check 2026-10-08 ~08:58 CT: the box `PYTH_HERMES_API_KEY` gets **HTTP 403 "Not entitled … asset type 'equity'"** for AAPL (crypto BTC/USD → 200). Until the key's plan includes equities, Hermes pull settle and the Hermes fallback both refuse and the operator price is what settles the 20-min market. |
| **Tests** | Red first: `test/staging-gates.test.ts` (20) + 1 in `pull-oracle.test.ts` → automation **93 passing + 11 pending**, `tsc` clean. Box `DRY_RUN=1` with a synthetic two-book pre-!73 state: handoff repair + gate ran read-only against devnet, exit 0, zero transactions. |
| **Related** | DLV-101 · DLV-102 · DLV-103 · DLV-106 · DLV-097 · DLV-085 · review mr72-73 M3 / L4 |

---

## 2026-10-08T08:45:00-05:00 — Engineers: paused Phoenix book = cancel/withdraw only (localnet proof + ticket copy) and Reviewer ops/web nits

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `test/phoenix-paused-book` from `origin/main` @ `6d04b00` (after !74/!75 docs) |
| **Source** | Testers' gap on !73 (no localnet proof that a Paused book refuses new orders but allows cancel + withdraw; no ticket copy for the Phoenix paused error) + Reviewer nits (pull-settle silent skip on a missing settler key, order-book footer 4s vs 6s poll, `pause-status` given the pauser key) |
| **Mechanism (verified)** | `phoenix-v1`: on a Paused header, `PlaceLimitOrder` (limit / post-only) fails `assert_post_allowed` ("Post only order is not allowed, market status is Paused"), `Swap` (IOC/FOK) fails `assert_cross_allowed` ("FOK and IOC orders are not allowed, market status is Paused"), both as `InvalidAccountData`; cancel and `WithdrawFunds` load `CancelOrWithdrawContext` (`reduce_allowed`: Active/PostOnly/Paused/Closed). `WithdrawFunds` takes no seat account (unlike `DepositFunds`). |
| **Change** | `apps/automation/test/phoenix-pause.localnet.test.ts`: second opt-in describe (same `PHOENIX_LOCALNET_RPC` gate as the 6 PSM tests). Bootstrap-identical book + pauser handoff, maker/taker seats via PSM `ClaimSeat`, maker rests ask 2 @ 0.60 + bid 2 @ 0.40, taker FOK-buys 1 while Active (control), `runPausePass` pauses, then: FOK buy/sell refused, limit (crossing and resting) + post-only refused, balances/vaults unchanged; maker `CancelMultipleOrdersById` + `WithdrawFunds(all)` (the Portfolio cancel ixs) succeed and return every atom (9 contracts, 10.60 USDC, vaults 0); stand-alone `WithdrawFunds` succeeds. Web: `PHOENIX_MARKET_PAUSED_MESSAGE = "Market paused, cancel or withdraw only"`; `explainPlaceError` maps the Phoenix paused log to reason `market-paused`; `placePhoenixOrder` also reads logs from `.logs` / wallet-adapter `.error.logs`, and for a bare `InvalidAccountData` without logs reads the book header (status 3) via `pausedCopyForFailedPlace`; the ticket shows the copy for preflight failures and for an on-chain failure after confirm (pause landing between simulation and confirmation). Cancel/withdraw paths untouched. Nits: `ops/lib/pull-settle.cjs` `pullSettlePlan` names every missing input and warns `WARNING settler.json (settler key) missing at …`; skip line `pull settle skipped: settler.json (settler key) missing at … — legacy settle / admin_settle fallback`. Order-book footer = `liveBookFooter()` from `POLL_MS.tradeBook` (6s). `run-staging.sh` `ops_cli_ro` (env -u PHOENIX_PAUSER_KEYPAIR -u SETTLER_KEYPAIR) for `pause-status`; README example without the key. No program or IDL change. |
| **Tests** | Red first. Web: errors 7, client 5, ticket wiring 2, poll footer 2 → web vitest **348** + 14 skipped, `tsc` + lint clean. Automation: `ops-staging-nits.test.ts` 6 → **72 passing + 11 pending** (opt-in localnet); `phoenix-pause.localnet.test.ts` **11/11** on a temporary :8699 validator with the real Phoenix + PSM programs (validator stopped afterwards; :8899 untouched). |
| **Related** | DLV-099 · DLV-100 · DLV-097 · DLV-085 · !73 |

---

## 2026-10-08T08:40:00-05:00 — Testers: !74 Reviewer nits (STAGING_TEST_PLAN 1.2d / 7.3b / 7.3c / 7.5 / 7.6, known limits; VISUAL_RUNBOOK 13 / 14 / 16.4) + runbook Tester setup

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Branch** | `test/runbook-nits` from `origin/main` @ `fc862c2` (Merge !74) |
| **Decision** | Docs-only follow-up to MR !74 note 127780 (Reviewers, non-blocking nits), checked against code at `fc862c2`. (1) 7.3b / runbook 13: Cancel is `CancelMultipleOrdersById` + `WithdrawFunds(all)` (`buildCancelIxs`), so Withdraw-after-Cancel had nothing to act on. Wallet B now partly fills A's 2 @ 0.50 bid before expiry (Buy No · Market · 1), and Withdraw runs **first** on the paused book, then Cancel / Cancel all; with no partial fill, Withdraw is **N/A**, not Pass. (2) 7.3c / runbook 13.4: Paused is confirmed by `ops-cli pause-status` or `solana account … --output-file` + `xxd -s 8 -l 8` (`0300 0000 0000 0000`); dropped the `--output json` read (base64). (3) The `admin_settle` fallback price is the last published **mainnet** Pyth AAPL price read once at about expiry + 330 s (`ops/pyth-read.py`, `PYTH_PRICE_RPC` default mainnet-beta, `run-staging.sh` log `(last published mainnet Pyth)`), not the expiry-time price: noted in §0, §7, 7.6, 9.3, known limits and runbook 14 / 15.2 / known limits. (4) 7.5: pull settle is also skipped without the box `settler.json` while the skip line names only the Hermes key / `AUTOMATION_DIST` (log fix left to the Engineers). (5) Known limits: M1 / M2 / M4 / M5 marked closed (re-reviewed and approved: !67 note 126470, !69 note 126471), §0 web-cluster row updated; the `ops/` row now points to the pending security pass. (6) 1.2d: `pause-status` run without `PHOENIX_PAUSER_KEYPAIR` (it never loads the key; `ops-cli.ts`), with the pauser pubkey taken from the `pause watcher started` line. (7) Runbook 16.4: optional HTTP-status-only check (`curl -s -o /dev/null -w '%{http_code}'`), never open or print the dev-wallet body. (8) Runbook: new top section **Tester setup (do this first)** for a first-time, non-operator tester. Track A: the operator updates the box to latest `main`, and the tester uses the box desktop (localhost:3000 + Localnet Dev Wallet). Track B: install Phantom, Testnet Mode → Solana Devnet, wallet A + second account wallet B, send both **public** addresses, wait for funding (STAGING_TEST_PLAN 1.4 / 1.5), and recognise mUSDC `GEBRsT3Nc3PaEio2qf3x4JUgFtPSYXr7bmVitMuzMBXq` (RAILWAY_STAGING §0) as an unknown token by its first and last characters. It ends with a one-line readiness check and an explicit never-share-seed-phrase/private-key warning. Reviewer nit 8 (OrderBook `refreshes every 4s` copy) is the Engineers' and isn't in this MR. Docs only. |
| **Files** | `docs/STAGING_TEST_PLAN.md`, `docs/VISUAL_RUNBOOK.md`, `docs/AI_LOG.md` |
| **Related** | !74 · !73 · !67 · !69 · DLV-097 · DLV-085 · M1 · M2 · M4 · M5 |

---

## 2026-10-08T08:20:00-05:00 — Testers: VISUAL_RUNBOOK (click-by-click, localnet + devnet) and STAGING_TEST_PLAN for !73 pause at expiry + settle chain

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Branch** | `test/visual-runbook` from `origin/main` @ `7219ac1` (Merge !73) |
| **Decision** | (1) New `docs/VISUAL_RUNBOOK.md`: 17 use cases × Track A (localnet :3000, Localnet Dev Wallet) / Track B (devnet staging, Phantom + wallet B). Every step has Click / Do, You should see, and a Pass box. UI strings are copied from `apps/web/src` @ `7219ac1`. It also lists the `/workspace/meridian-*.png` reference shots (localnet, 2026-10-07; some predate !63/!67) and a known-limits box (DLV-069, maker fills missing from History, Pyth off-hours → `admin_settle`). (2) `STAGING_TEST_PLAN.md` updated for !73. At expiry the pauser sends PSM `ChangeMarketStatus` → `Paused` (worker tick + exact-time timer; box `pause-once` / `pause-watch`). New orders are rejected on-chain (phoenix-v1 `assert_post_allowed` / `assert_cross_allowed`: `Post only order is not allowed, market status is Paused` / `FOK and IOC orders are not allowed, market status is Paused`, `invalid account data for instruction`), while cancel and withdraw still work (`reduce_allowed`). The app has no paused-specific copy: the ticket is already **Trading closed**, and `errors.ts` `Paused` is the Meridian config pause, not the Phoenix status. Rewrote 7.3b (blocked trading; Cancel, Cancel all and Withdraw succeed) and added 7.3c (status = Paused via `ops-cli pause-status` or Phoenix header u64 @ 8 = 3). The §7 box now covers the expiry-to-pause window and replaces the "books stay tradeable" known limit. Settle chain as coded: box `settle-test.cjs` runs pull-settle (sponsored → Hermes) → legacy sponsored `settle` → `admin_settle` at expiry + 330 s; automation runs sponsored → Hermes → `admin_settle` after 20 tries plus a fixed price. Signers: settler / authority / pauser. Added §0 rows, 1.2d (Railway `PHOENIX_PAUSER_KEYPAIR`, Debu's secret, and handoff check), 1.7 READY line, a §4 note on post-expiry runs, §9 Pyth-settle variants, a coverage gap (no localnet test for orders / cancel / withdraw on a paused book), and known limits. Docs only. |
| **Files** | `docs/VISUAL_RUNBOOK.md` (new), `docs/STAGING_TEST_PLAN.md`, `docs/AI_LOG.md` |
| **Related** | !73 · DLV-097 · DLV-098 · DLV-085 · DLV-069 · DLV-088 · D-025 · M3 |

---

## 2026-10-08T01:05:00-05:00 — Engineers: pause Phoenix books at expiry (pauser + PSM handoff), ops/ scripts in git, Hermes pull settle

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `feat/phoenix-pause-ops` from `origin/main` @ `578af22` (!72) |
| **Source** | `/workspace/meridian-review-fixes-dd46769.md` ("Open risk: Phoenix books stay live after expiry", staging condition 7) + DLV-085 |
| **Mechanism (verified)** | Read `phoenix-seat-manager-v1` 31ad32a and `phoenix-v1`: staging books' Phoenix authority is the Seat Manager PDA (`[market]` under PSMxQb…), so a status change must go through PSM `ChangeMarketStatus` (8), checked against `SeatManager.authority` (initially the `ClaimMarketAuthority` payer = upgrade key `2DTwL4…`). PSM `NameSuccessor` (6, signed by the current SM authority) + `ClaimSeatManagerAuthority` (7, signed by the successor) move it per book. The review's mechanism is right. One correction found on localnet: ix 8 needs the seat-manager PDA **writable** (Phoenix's ChangeMarketStatus marks its authority writable; read-only fails with "writable privilege escalated") although the PSM IDL lists it read-only. `Paused` (3): Phoenix `reduce_allowed` only, so cancel + withdraw work, no posts/crosses; `Paused → Active` is valid for recovery. |
| **Change** | `apps/automation/src/phoenix/seatManager.ts` (PDAs, PSM 6/7/8 builders, header/SM decoders) and `pauseAtExpiry.ts` (`planPauses`, `nextPauseDelayMs`, `runPausePass`, dataSlice reads of 16/96 bytes per book, missed-pause/handoff alerts). Worker: `PHOENIX_PAUSER_KEYPAIR` (`resolvePauser` refuses the authority and the settler; required on mainnet-beta; unset → warning), pause pass each tick + exact-time follow-up timer (`followUpDelayMs`). `ops-cli.ts`: `pause-status`, `pause-once`, `pause-watch`, `handoff`, `pull-settle`. Calendar: the pre-16:00 idle log is now `waiting for 16:00 ET gate (now HH:MM ET)` instead of an `Error:` line. `ops/`: the box-only `run-staging.sh`, `devnet-bootstrap.cjs`, `settle-test.cjs`, `/tmp` pyth-read helper and the staging e2e are committed with every key path, RPC, program id and secret from env (`staging.env.example`, README). Bootstrap funds the pauser (faucet first) and hands each book to it right after the book exists; the pipeline runs a background `pause-watch`, pauses the 20-min book at expiry, settles through Pyth pull (settler + `PYTH_HERMES_API_KEY`, Bearer header only) and keeps `admin_settle` as the fallback. Env docs: DEPLOY, RAILWAY_STAGING, `automation.staging.env.example`. No program or IDL change. |
| **Tests** | TDD (red first): `phoenix-pause.test.ts` 18 (builders incl. the writable SM, decoders, planning, timer, pass, config, ops `psm.cjs` parity, state source), `calendar-gate-log.test.ts` 1. Opt-in `phoenix-pause.localnet.test.ts` 6/6 against the real Phoenix + PSM programs on a temporary :8699 validator (bootstrap-identical book; pauser refused before handoff; handoff; old authority refused after; `runPausePass` pauses, second pass no-op; resume). automation **66 passing + 6 pending** (72 with the validator), typecheck + `build:railway` clean. `DRY_RUN=1 ops/run-staging.sh` exit 0. |
| **Related** | DLV-097 · DLV-098 · DLV-085 · DLV-094 · review dd46769 · D-025 · M3 |

---

## 2026-10-08T00:50:00-05:00 — Engineers: web Lows from review dd46769 (Portfolio settled-book polling, card M5 lock)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/web-lows-poll-cardlock` from `origin/main` @ `4d9e561` |
| **Source** | `/workspace/meridian-review-fixes-dd46769.md`, !67 "Remaining (Low)" 1 and 2 |
| **Change** | (1) Portfolio no longer re-reads every settled Phoenix book every 30 s. `nextSettledPhoenixDone` marks a settled market once this wallet's seat there reads empty (no seat, all four balances 0, no resting orders); `accountRefsFor(..., { settledPhoenixDone })` then drops that book from the poll (ATAs still read for redeem). A settled market with withdrawable leftovers or resting orders stays polled until the wallet withdraws/cancels. An empty seat on a settled book can't refill without a new order from this wallet, so nothing is missed. `usePortfolio` keeps the set per wallet; `useWalletAccount` gains opt-in `keepPrevious` (Portfolio only, owner-guarded) so the shrinking key doesn't flash a loading state. (2) Market cards, table and ladder Buy links apply the M5 lock: `useWalletPositions` now returns `{ positions, lock }` (`walletPositionsLock`: pending → `loading`, failed with no data → `error`), and `cardAvailabilityOptions` feeds it into `useIntentAvailability`, so a failed read shows "Couldn't read your balances. Retrying…" instead of enabled-as-flat. |
| **Tests** | TDD: `pollPolicy.test.ts` +4 and new `cardLock.test.ts` (8) written red first. web vitest **332 passed / 14 skipped** (was 320/14), `tsc --noEmit` clean, `next lint` clean. |
| **Related** | !67 · M4 · M5 · review dd46769 Lows 1–2 |

---

## 2026-10-07T23:40:00-05:00 — Engineers: TRACKER sync after Reviewer fixes (!67, !69, !70)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `docs/tracker-reviewer-fixes` from `origin/main` @ `ab3b57c` (!70) |
| **Change** | The TRACKER header cited `7f8e766` (Reviewers' nit); it now cites the real tip `ab3b57c`. Adds Done rows DLV-091 (!67: M1/M4/M5 + L8/L10/L11/L12/L13/L14), DLV-092 (!69: M2) and DLV-093 (!70: M3). Adds Todo rows for the `SETTLER_KEYPAIR` Railway secret and the deferred Reviewer Lows (L1–L7, L9). Corrects the three Engineers AI_LOG timestamps above to the real merge times (they had been written ahead of the clock). |
| **Evidence** | Docs only. Counts cited: web vitest 320 passed / 14 skipped (opt-in E2E), web `tsc` clean · automation 47/47 · prod LiteSVM `settle_pull_oracle` 22/22 · root `tests/unit` 7/7. The full Anchor localnet suite was not re-run; it needs `:8899`, which is reserved for Debu's localnet. |
| **Related** | DLV-091…093 · M1–M5 · L1–L14 · !67 · !69 · !70 |

---

## 2026-10-07T23:37:00-05:00 — Engineers: M3 separate low-balance settler key (no program change)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/settler-key-m3` rebased on `origin/main` @ `6e3c91b` (!69) |
| **Source** | `/workspace/meridian-review-mr52-61.md` **M3** (!57) |
| **Finding** | `settle` already needs no authority: `Settle.settler` is a bare `Signer` with no `has_one` or constraint (`programs/meridian/src/instructions/settle.rs`). So there's **no program, Config or IDL change, and nothing that affects the devnet deploy**. The authority was only used because automation passed `settler: opts.authority`, and Anchor `.rpc()` also made the authority the fee payer (provider wallet). |
| **Decision** | TDD. Automation: new `SETTLER_KEYPAIR` → `resolveSettler(cfg, authority)`. The settler must differ from the authority and is **required on mainnet-beta**; devnet/localnet fall back to the authority with a loud warning. The settler gets its own `Program`/provider, so it signs **and pays** for settle (legacy path, and pull path: Pyth post + `settle`). `admin_settle`, create and `set_phoenix_market` stay authority-only. Prod LiteSVM characterisation test **PULL-M3**: a non-authority key holding 0.01 SOL settles on the prod `.so`. Docs: DEPLOY, RAILWAY_STAGING, SIM_LIFECYCLE and `automation.staging.env.example`. The box-only staging ops scripts were updated separately (backed up, dry-run, watcher restarted). |
| **Evidence** | automation `npm test` 47/47 (was 37; +10 in `settler-key.test.ts`) · automation `tsc --noEmit` clean · `tests/prod/settle_pull_oracle.ts` **22/22** on the prod `.so` (staging build of the same `programs/` tree, `assert-prod-no-fixtures` PASS) · root `tests/unit` 7/7. |
| **Needs Debu** | Set a Railway secret `SETTLER_KEYPAIR` (low-balance, about 0.05 devnet SOL) on the automation service. Until then devnet automation keeps settling with the authority and logs a warning. |
| **Related** | M3 · D-025 (pull settle) · !57 · !70 |

---

## 2026-10-07T23:34:00-05:00 — Engineers: M2 fixtures need a loopback RPC (`custom` label no longer enough)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/fixtures-custom-loopback` from `origin/main` @ `7aa1fe5` (!67) |
| **Source** | `/workspace/meridian-review-mr52-61.md` **M2** (!59) |
| **Decision** | TDD. `isFixtureCluster(cluster, rpcUrl)` / `fixturesAllowed(cluster, rpcUrl)` now require a fixture-style label (`localnet` / `localhost` / `custom`) **and** a loopback RPC (`127.0.0.1` / `localhost` / `[::1]`, shared `LOOPBACK_RPC` with the dev-wallet gate; look-alikes like `127.0.0.1.evil.com` / `localhost@evil.com` rejected). `rpcUrl` defaults to the raw `NEXT_PUBLIC_SOLANA_RPC_URL` (no devnet fallback, so unset = off). Applies to fixture markets, the fixture book, middleware fixture slugs (→ 404) and the demo portfolio. Kept `custom` for loopback validators on other ports. Existing localnet-mode tests now set a loopback RPC explicitly. |
| **Evidence** | web vitest 320 passed / 14 skipped (new `fixtureRpcGate.test.ts` 12) · `tsc --noEmit` clean. Debu's `.env.local` (localnet + `127.0.0.1`) is unaffected. |
| **Files** | `apps/web/src/lib/market/marketIdRoute.ts` · `lib/solana/config.ts` · `middleware.ts` · `lib/solana/localnetDevWallet.ts` · tests · `docs/RAILWAY_STAGING.md` |
| **Related** | M2 · DLV-084 · DLV-081 · !59 |

---

## 2026-10-07T23:33:00-05:00 — Engineers: Reviewer Mediums M1/M4/M5 + L8/L10/L11/L12/L13/L14 (web)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Branch** | `fix/web-reviewer-mediums` from `origin/main` @ `ea84698` |
| **Source** | `/workspace/meridian-review-mr52-61.md` (M1, L8, L10) · `/workspace/meridian-review-mr63.md` (M4, M5, L11–L14) |
| **Decision** | TDD (failing vitest first, then the fix). **M1/L12:** sizes must be a positive whole number of Phoenix base lots — refused in the ticket (inline error, CTA disabled) and in `placePhoenixOrder` before anything is loaded or signed (`lotSizeError`), then authoritatively from the loaded market (`contractsToLots`): one integer lot count drives mint raw (= lots × baseLotSize), the Phoenix size and the FOK min-fill; half-lot headroom so the SDK float floor can't drop a lot (0.29 / 0.01-lot → 29, not 28). **M4:** server-side TTL cache + in-flight dedupe for the market scan (`MARKET_LIST_CACHE_MS`, default 20 s; failures 3 s), shared by `listMarkets`, `/api/markets` and `getMarket` misses (closes **L10**); Header reads only settled markets' ATAs, no Phoenix (60 s, was 30 s over everything); Phoenix market-state reads only for open markets (Portfolio also reads settled seats for withdraw leftovers); trade account 10 s (was 4 s), book 6 s and paused while hidden / not open; history 60 s and only while the Fills tab is open on the trade page; 429 → exponential backoff (cap 5 min). **M5:** connected + no data + read error → locked ("Couldn't read your balances. Retrying…") with a Retry button — fails closed. **L8:** market worst price clamped to `[minPrice, maxPrice]`. **L11:** one-line sweep disclosure on the ticket and in the success toast. **L13:** Cancel all chunked (20 orders/tx; a full chunk serialises ≤ 1232 bytes). **L14:** success only after `confirmTransaction` with no `value.err`; failed → error, timeout → "not confirmed, check explorer" (Phoenix actions and the ticket). |
| **Evidence** | web vitest 310 passed / 14 skipped (was 252/14) · `tsc --noEmit` clean. No program / IDL / automation changes. |
| **Files** | `apps/web/src/lib/phoenix/{size,client,compose,manage,sweepCopy,types,index}.ts` · `lib/rpc/pollPolicy.ts` · `lib/indexer/{index,listCache}.ts` · `lib/intents/resolveInputs.ts` · `lib/solana/confirm.ts` · hooks (`useWalletAccount`, `useMarketAccount`, `usePortfolio`, `useWalletPositions`, `useWalletHistory`, `useMarketList`, `useIntentAvailability`) · `TradeTicket.tsx` · `TradeClient.tsx` · `Header.tsx` · `PhoenixActions.tsx` · tests |
| **Related** | M1 · M4 · M5 · L8 · L10 · L11 · L12 · L13 · L14 · D-024 · DLV-070 · DLV-087 · DLV-088 · !54 · !63 |

---

## 2026-10-07T23:20:00-05:00 — Testers: devnet staging acceptance test plan (Phantom)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Branch** | `test/staging-test-plan` from `origin/main` @ `0d856ed` (!64) |
| **Decision** | Add `docs/STAGING_TEST_PLAN.md`: a step-by-step Phantom checklist (Action / Expected / Pass-Fail) for Railway staging https://web-production-77fbb.up.railway.app on devnet, program `9Rb7nx…`, to run once the prod `.so` is deployed (DLV-077). Every step is grounded in main @ `0d856ed` (`apps/web` labels and toasts, `programs/meridian` errors and seeds, RAILWAY_STAGING §0 params: mUSDC, `admin_settle_delay_secs` 300). Covers connect, the four intents × Market/Limit, a resting fill by a 2nd wallet + Cancel / Withdraw to wallet (DLV-087, !63), real Portfolio/History (DLV-088, !63), the opposite-side UI gate (the program doesn't block, by design), the 20-min AAPL ≥ 300 close + operator `admin_settle` (Policy A, delay), redeem, the settle proof card, the payoff line, and Explorer invariants (vault == `pairs_minted − pairs_redeemed`, Yes == No supply while Open) at mint / trades / settle / redeem with PDA seeds + raw `StrikeMarket` offsets. Marked pending on main: resting Sell No merge-on-fill (DLV-069) and History maker fills. The short market has no Phoenix book (box bootstrap), so the plan asks the operator for tokens. Lists automated gaps (no component tests, opt-in E2E needs local seed scripts, no labs CI runners) and a sign-off table. Docs only: no deploy, no Railway, no validators. |
| **Files** | `docs/STAGING_TEST_PLAN.md` · `docs/TRACKER.md` · `README.md` · `docs/AI_LOG.md` |
| **Related** | DLV-077 · DLV-085 · DLV-087 · DLV-088 · DLV-069 · D-018 · D-024 · D-025 · !63 · !64 |

---

## 2026-10-07T23:40:00-05:00 — Testers: STAGING_TEST_PLAN reviewer fixes (!63/!65 notes) + TEST_RESULTS count nit

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Branch** | `test/staging-plan-review-fixes` from `origin/main` @ `ea84698` (!66); re-checked against `dd46769` (!67 + !69 + !70 + !71) in follow-up commits |
| **Decision** | Address the Meridian Reviewers' requested doc changes on `docs/STAGING_TEST_PLAN.md` (MR !65 notes; `meridian-review-mr63.md`). (1) **1.1b [operator]** deployed-binary check: `solana program dump -u devnet 9Rb7nx… /tmp/m.so && bash scripts/assert-prod-no-fixtures.sh /tmp/m.so idl/meridian.prod.json` → no fixture strings (prod `.so` only), plus an optional 1.1c `InstructionFallbackNotFound` negative. (2) **1.2b / 2.1** `NEXT_PUBLIC_SOLANA_CLUSTER=devnet` set explicitly; never `custom` on staging (M2 fixed by !69, but Explorer links and the chip still depend on the label; no URL cluster param exists). (3) **2.3b / 2.4b** `curl -I` + browser 404 checks for `/markets/fixture-anything` and `/api/localnet-dev-wallet`. (4) **Known limits** table: M1/M4/M5/L11/L13/L14 marked fixed in the web by !67 and M2 by !69 (not yet re-reviewed); M3 moved out of known limits into a how-settle-works note (§0 settler row, 1.2c `SETTLER_KEYPAIR` precondition, §7) after !70; unreviewed box-only ops scripts; post-expiry window; Hermes/`admin_settle`. (5) **§3** whole-contracts caution, with what the ticket, `size.ts` and the order path do with fractions on `7aa1fe5` (refused before signing) and before !67, plus the 3.11 check. (6) **4.9–4.11** sweep next to a resting order (order still resting, seat free 0, L11 sweep copy) and failed fill-or-kill atomicity (seat unchanged). (7) **§7** Phoenix books stay live between expiry and settle: what to expect and avoid, plus optional 7.3b. (8) **§11.1** "Absolute byte offsets (including the 8-byte discriminator)". The 20-min AAPL market now has a Phoenix book and wallet B is funded **per staging script** (box-only `run-staging.sh` / `devnet-bootstrap.cjs`, not in git), with fallback lines. TEST_RESULTS: per-prefix count rows fixed to sum to the headline 87 / 108 (`B 1` removed, S 15 → 14 = 10 + 4 `S-10` vectors, `U 3` compose added), sourced from the mocha logs (`108 passing`; hardening 66 ✔ + 33 passing = 87 unique). Docs only: no deploy, no Railway, no validators, no code. (This entry sits below the !65 entry rather than on top so the branch merges cleanly next to the !67 / !69 / !70 entries without rewriting the branch.) |
| **Files** | `docs/STAGING_TEST_PLAN.md` · `docs/TEST_RESULTS.md` · `docs/AI_LOG.md` |
| **Related** | !63 · !65 · !66 · !67 · !69 · !70 · Reviewers M1/M2/M3/M4/M5, L11/L12/L13/L14 · DLV-077 · DLV-085 · DLV-087 · D-024 · D-025 |

---

## 2026-10-07T14:30:00-05:00 — Orchestrator: web Phoenix order-path fixes from live localnet (DLV-066) + sizing correction (D-020)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (Orchestrator) |
| **Branch** | `fix/web-phoenix-onchain-orders` from `origin/main` @ `0c173ac` |
| **Context** | Debu could not place an order on localnet. Loading Phoenix V1 + Seat Manager into `solana-test-validator`, creating real Yes/USDC books and trading through the web client exposed bugs that the book-sim harness (DLV-064) could not see. |
| **Decision** | (1) Load Phoenix markets with `Client.createWithoutConfig` (on-chain) instead of `createWithMarketAddresses`, which fetches Ellipsis' GitHub `master_config.json` and throws for any unlisted market (all localnet / new markets). (2) **Sizing correction (D-020):** SDK `sizeInBaseUnits` = whole tokens, not atoms — the !33 Reviewer-High sign-off ("mint raw == Phoenix size") was wrong and oversized orders 10⁶×; fixed + `size.test.ts` rewritten. (3) Buy No mint: pass optional `sim_clock` only when the PDA exists (Anchor auto-resolved it → `AccountNotInitialized`); read `treasury` from `Config` in the RPC indexer (not on StrikeMarket → `mint-accounts-missing`); idempotent Yes/No/USDC ATAs + 800k CU in the same tx. (4) Ticket re-anchors price to the intent's touch (Yes vs No terms) and follows the live book for Market; book polls 4s; live wallet balances drive Position + intent gating; RPC indexer attaches Phoenix top-of-book; live pages `force-dynamic` + `fetchCache=force-no-store`. (5) `emit-prod-idl.js` also strips fixture **accounts/events** (SimClock / SimClockSet) whose types it already stripped — Anchor `new Program()` threw on the dangling refs and the web GPA path silently fell back to fixtures. (6) `settleStatusLabel` moved to SSR-safe `lib/market/status.ts` (was in a `"use client"` module → RSC mapping threw). |
| **Evidence** | Localnet (Phoenix `PhoeNiXZ8…` + PSM `PSMxQb…` from mainnet dumps, 8 books): Buy Yes / Buy No / Sell Yes / Sell No market orders filled through `placePhoenixOrder` with balance deltas; Buy Yes + Buy No clicked through the real UI. `tsc` clean, vitest 38/38. |
| **Gaps (Todo)** | DLV-068 live Portfolio/History/Open orders/Fills · DLV-069 merge-on-fill for resting Sell No · DLV-070 Buy No under-fill (slippage cap) can leave Yes+No. |
| **Related** | D-015 · D-018 · D-020 · DLV-055/060/064 · DLV-066 |

---

## 2026-10-07T09:55:00-05:00 — Orchestrator: TRACKER sync post-!41 SimClock (tip 7436e49)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (Orchestrator) |
| **Branch** | `docs/tracker-post-41` from `origin/main` @ `7436e49` (!41) |
| **Decision** | Cite **MR !41** on DLV-065 SimClock Done line (remove "MR pending"); refresh tip SHA; move DLV-037 demo readiness to Done (!40; video = DLV-038 Todo); In Progress empty. Todo: optional UI sim (DLV-048), demo video (DLV-038), SCHEMA §8 residual (DLV-042). Workspace mirrors updated. No prod/web/localnet changes. |
| **Files** | `docs/TRACKER.md` · `docs/AI_LOG.md` |
| **Related** | D-017 · DLV-065 · DLV-037 · DLV-038 · !41 · tip `7436e49` |

---

## 2026-10-07T09:35:00-05:00 — Reviewers: DLV-037 demo/continuous readiness (conditional pass)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Reviewers (report); Grok Bot (docs polish MR) |
| **Tip reviewed** | `bcf5d23` (advanced past asked `92d414e`) |
| **Decision** | **CONDITIONAL PASS** — fixtures/localnet Peak6 walkthrough demo-ready with doc nits. Sell No Highs (!33) PASS (code); DEMO_SCRIPT ready via `yarn test`/PHX; security regression PASS; DLV-039 TEST_RESULTS Accept 74/74 for cited tips. Docs polish: README Sell No, DEMO_SCRIPT automation:sim, TEST_RESULTS Phoenix Done (!38), SPEC counts/MAG7, TRACKER tip. Railway deferred; **DLV-038 video** out of scope / still Todo. |
| **Report** | `/workspace/meridian-review-demo-bcf5d23.md` |
| **Branch** | `docs/dlv037-demo-readiness-nits` |
| **Related** | DLV-037 · DLV-038 · DLV-039 · DLV-064 · !33 · !34 · !38 · !37 |

---

## 2026-10-07T09:30:00-05:00 — DLV-064 Phoenix on-book sim E2E (Meridian Engineers / Grok Bot)

| Field | Value |
| --- | --- |
| **Decision** | Replace off-book Yes SPL placeholder as the **preferred** sim trade path with **`simTradeOnBook`**: compose (Buy/Sell Yes; Buy No = mint+ask; Sell No market = bid+`merge_pair`) + **book-sim** Yes↔USDC fill at planned price + real Meridian mint/merge. Mocha **PHX-01…06**. Off-book kept as demoted V-08/fallback only. **No** Meridian Phoenix CPI matcher. |
| **Residual** | Full Phoenix V1 `.so` + `InitializeMarket` + seat manager on `solana-test-validator` **not** wired — SDK has place/cancel but not TS market-create; documented in `docs/phoenix-onbook-sim.md`. `PHOENIX_ONBOOK_MODE=phoenix` reserved/throws until then. |
| **Files** | `tests/helpers/phoenix_{compose,onbook}.ts` · `tests/phoenix_onbook_e2e.ts` · `tests/unit/phoenix_compose.ts` · harness `simTradeOnBook` · DEMO_SCRIPT / SIM_LIFECYCLE / automation sim log · TRACKER/AI_LOG |
| **Branch** | `eng/dlv064-phoenix-onbook-e2e` |
| **Result** | MR !38 merged — PHX suite **9/9** focused localnet; off-book demoted. |

## 2026-10-07T09:25:00-05:00 — DLV-065 SimClock PDA (Meridian Engineers)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (executor) |
| **Branch** | `eng/dlv065-sim-clock` from `origin/main` @ `245c86d` (!38) |
| **Decision** | Land **DLV-065 / D-017** SimClock PDA seeds `["sim_clock"]` + ixs `init_sim_clock` / `set_sim_clock` / `warp_sim_clock` / `disable_sim_clock` under `#[cfg(feature = "localnet-test")]` only. `effective_clock` wires mint / settle / admin_settle (+ Pyth `slot_now`); optional `sim_clock` account on those contexts. Harness `initSimClock`/`set`/`warp`/`disable`; SC-01…03 prove warp→settle / mint-after-expiry / admin_settle delay=1800 without wall sleep. **Does not** weaken !34 Clock-poll `waitPastExpiry` for non-sim paths. Prod `.so` / prod IDL strip fixtures (assert-prod-no-fixtures). Program id unchanged `9Rb7nx…`. |
| **Files** | `programs/meridian/src/{state/sim_clock,utils/clock,instructions/*_sim_clock}.rs` · mint/settle/admin_settle · harness · `tests/sim_clock.ts` · emit/assert scripts · TRACKER/AI_LOG |
| **Result** | Focused SC **4/4**; prior full suite **84/84** non-SC green; expected full **87/87** after SC fix (idempotent init + resetSimClockToNow). **MR !41 merged** → main @ `7436e49`. |
| **Related** | D-017 · DLV-065 · !14 · !34 · !38 · !41 |

---


# Meridian AI decision log

## 2026-10-07T09:16:00-05:00 — Schema: D-019 pin MAG7 Pyth feed ids (DLV-041)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Branch** | `schema/mag7-pyth-feeds` from `origin/main` @ `654ec8f7` (post-!36 DLV-039; prior tip note `92d414e`) |
| **Decision** | **D-019:** Pin V1 MAG7 Pyth Core Hermes `Equity.US.*/USD` feed ids + shard-0 Solana price accounts (AAPL/MSFT/GOOGL/AMZN/NVDA/META/TSLA; Alphabet = **GOOGL**). Current Price Feed program `pythWSnsw…`; receiver owner `rec5EKM…`; upgrade caveat (`pyt2F414…` PDAs missing 2026-10-07 — re-pin after upgrade). SCHEMA §3.1 registry; §8 rewritten as V1 lock inventory (Phoenix Yes base D-004/D-015; strike `>=` D-005 propose close; space-pad / PDA seeds / burn_losing / fees0 / settle window V1 OK; merge_pair/Settling/Policy A locked D-018; multi-collateral OOS). **Needs Debu lock:** merge D-019; confirm keep `>=` vs Peak6 `>` if still product-open. Docs only — no eng/program/tests. |
| **Files** | `docs/SCHEMA.md` · `docs/DECISIONS.md` · `docs/TRACKER.md` · `docs/AI_LOG.md` |
| **Related** | DLV-041 · D-019 · D-005 · D-018 · Grok Bot wake · main tip was `92d414e` then `654ec8f7` |

---

## 2026-10-07T09:15:00-05:00 — Testers: Peak6 PRD test results artifact (DLV-039)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Branch** | `test/dlv039-test-results` from `origin/main` @ `92d414e` |
| **Decision** | Land **DLV-039** package/report: `docs/TEST_RESULTS.md` citing eng localnet **74/74** on suite-green tip `65c1ddf` (!34 X-03/SIM-08 flake harden) and docs tip `92d414e` (!35). Layers: P0/P1/SIM/MP/P2+INV. Flake evidence: pre-harden `3051584` was 72/74 (timing only). No suite re-run in this MR; no Rust. Handoff to Reviewers for demo readiness (video DLV-038 still open). |
| **Files** | `docs/TEST_RESULTS.md` · `docs/TRACKER.md` · `docs/EVALS.md` · `docs/METRICS.md` · `docs/TASKS.md` · `tests/README.md` · `README.md` · `docs/AI_LOG.md` |
| **Related** | DLV-039 · D-016 · D-017 · D-018 · !32 · !34 · EVALS Reporting |

---

## 2026-10-07T08:22:34-05:00 — Orchestrator: TRACKER sync post-!20…!34 (tip 65c1ddf)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (Orchestrator) |
| **Branch** | `docs/tracker-post-34` from `origin/main` @ `65c1ddf` (!34) |
| **Decision** | Refresh `docs/TRACKER.md` to tip after !20–!34: SPEC **Done/locked**; UI (!22/!23) Done; automation dual-mode (!21) Done; Phoenix place+Buy No (!28) Done; D-018 merge_pair (!29–!31) Done; P2 gates (!32) Done; Sell No client (!33) Done; X-03/SIM-08 flake harden (!34) Done — localnet **74/74**. In Progress: Reviewer demo readiness only. Todo: on-book sim E2E, SimClock PDA, optional UI sim, demo video, test-results artifact, MAG7 Pyth pins / SCHEMA §8. Workspace mirrors: `/workspace/meridian-deliverables.md`, `/workspace/meridian-kanban.md`. No prod/web code changes. Did not start localnet; did not touch running Next.js @ :3000. |
| **Files** | `docs/TRACKER.md` · `docs/AI_LOG.md` |
| **Related** | D-012 · D-016 · D-017 · D-018 · !20…!34 · program id `9Rb7nx…` |

---

Append-only log of agent decisions and orchestration events for Peak6 Meridian.
Timestamps are America/Chicago (CDT, UTC-5). Newest entries at the top.
Narrative detail lives here; locked decisions are indexed in [`DECISIONS.md`](DECISIONS.md).

---

## 2026-10-07T07:49:46-05:00 — Engineers: harden X-03 / SIM-08 localnet timing flakes

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/flake-timing-x03-sim08` rebased onto `origin/main` @ `5e30749` (!33 Sell No) |
| **Decision** | Harness-only flake fix (no prod program / A-05 / X-07 / merge_pair / apps/web changes). **X-03:** `now+2` → `expiryAfterMintSlack()` (`EXPIRY_MINT_SLACK_SECS=30`) so create+mint cannot race `MintAfterExpiry`. **SIM-08:** `waitPastExpiry` polls validator **Clock sysvar** until `unix_timestamp >= expiry[+delay]+2` (wall sleep alone lagged localnet Clock → `AdminSettleTooEarly`). Suite-wide mint-before-expiry slack: S-08/V-07, SIM-05…08, settle openMintThenExpire/A-01…A-03, fees V-06, pause X-02/X-04…X-06, redeem, invariants, merge_pair MP-*, p2_gates. Anchor/mocha timeout 240s. SimClock PDA (D-017) still deferred. Program id unchanged `9Rb7nx…`. |
| **Files** | `tests/helpers/fixtures.ts` · `tests/helpers/harness.ts` · `tests/{p1_edges,sim_session,settle,fees,pause,redeem,invariants,merge_pair,p2_gates}.ts` · `Anchor.toml` · `docs/AI_LOG.md` |
| **Related** | D-016 · D-017 · localnet tip was `3051584` 72/74 · !32 P2 · !33 Sell No |

---

## 2026-10-07T07:45:00-05:00 — Engineers: Sell No merge_pair client + size unify (Reviewer Highs)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/sell-no-merge-size` from `origin/main` @ `3051584` |
| **Decision** | Land Reviewer CONDITIONAL PASS Highs: (1) `buildMergeIx` + Sell No immediate `phoenix-then-merge` (market); resting limit/post-only keeps honest merge-on-fill caveat; fix stale “no merge ix / Schema TODO” copy. (2) Unify `contractsToRawAmounts` so mint raw == Phoenix `sizeInBaseUnits` (decimals=6 atoms). Medium: `PAUSE_BLOCKS` += `merge_pair`. No program id / keypair changes. |
| **Result** | web vitest green; resting merge-on-fill still phased. |
| **Files** | `apps/web/src/lib/solana/instructions.ts` · `phoenix/{compose,client,config,types,size}.ts` · `TradeTicket.tsx` · `tests/helpers/invariants.ts` · TRACKER/AI_LOG/DEMO_SCRIPT |
| **Related** | D-018 · Reviewer `/workspace/meridian-review-main-3051584.md` · !28 · !31 · !32 |

---

## 2026-10-07T00:30:00-05:00 — Engineers: green P2 A-05/R-08/X-07 + INV gates (D-018)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot |
| **Branch** | `eng/p2-invariant-gates` from `origin/test/p2-invariant-gates` @ `1f6fc77`, rebased onto `main` @ `9f175d7` (!31 merge_pair) |
| **Decision** | Implement Schema **D-018** P2 slices only: A-05 **Policy A** (`OutcomeInconsistent`) + X-07 **retire Settling** (unused/reserved; discriminant kept; Open-only `is_open`). **Did not** re-implement `merge_pair` (already green on main !31). No Phoenix matcher. Program id unchanged `9Rb7nx…`. |
| **Impl** | `errors.rs` + `admin_settle.rs` consistency check; X-07 suite flip documenting retirement; R-08 / INV-* via existing `burn_losing` + fee trunc / prod IDL. `waitPastExpiry` +1.5s slack (localnet Clock lag). |
| **Result** | Localnet **74 passing / 0 failing** (P0/P1/SIM + MP-01…08 + P2 A-05/R-08/X-07 + INV-*). |
| **Related** | D-016 · D-018 · !27 suite · !31 merge_pair · TEST_MATRIX Cluster H |

---

## 2026-10-07T00:19:00-05:00 — Eng: prod merge_pair greens MP-01…MP-08 (D-018)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers |
| **Decision** | Implement prod **`merge_pair(amount)`** (D-018 / Schema !29): burn equal Yes+No; vault pays `amount − redeem_fee_bps` (fee→treasury); `pairs_minted −= amount`; emit `Merged`. Pause blocks; **no expiry gate** (OK after `expiry_ts` while Open); settled → `MarketNotOpen`. Distinct from `redeem` / `burn_losing`. Not localnet-gated — appears in `idl/meridian.prod.json`. Harness `mergePair` already wired by Testers !30 — Eng only landed Rust ix + IDL; did **not** rewrite MP asserts. **Did not** touch A-05 / X-07 (P2 !27). No Phoenix matcher. |
| **Result** | Localnet **68 passing / 0 failing** (P0/P1/SIM + Cluster I MP-01…08). Branch `eng/merge-pair` from `origin/test/merge-pair-failing` @ `5c8c00d` (same stack pattern as !10→!11). |
| **Files** | `programs/meridian/src/instructions/merge_pair.rs` · `lib.rs` / `mod.rs` / `events.rs` · `idl/meridian.json` + `meridian.prod.json` (+ apps sync) · `tests/helpers/harness.ts` (`EXPECTED_INSTRUCTIONS`) · `docs/TEST_MATRIX.md` · `docs/TRACKER.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · D-016 · Testers !30 · Schema !29 · program id `9Rb7nx…` |

---

## 2026-10-07T00:06:00-05:00 — Testers: merge_pair red suite (D-018 / MP-01…MP-08)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers |
| **Decision** | Land failing suite for prod **`merge_pair`** (Schema !29 / D-018) on branch `test/merge-pair-failing` from `schema/merge-pair` tip. Cases **MP-01…MP-08**: Open happy; post-expiry OK; pause fails; settled fails; fee-on-payout (`redeem_fee_bps`); I2/I3; zero/insufficient; distinct from redeem. Harness `mergePair` → **TDD_RED** until IDL lands. Meridian tests only `merge_pair` — no Phoenix matcher. **Coordination:** A-05 Policy A + X-07 Settling retire covered by P2 suite !27; Schema !29 docs align — do **not** double-flip those in this MR. Eng implements only after this red suite (D-016). |
| **Files** | `tests/merge_pair.ts` · `tests/helpers/harness.ts` · `docs/TEST_MATRIX.md` · `tests/README.md` · `docs/TRACKER.md` · `docs/TASKS.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · D-016 · Schema !29 · P2 !27 · tip program id `9Rb7nx…` |

---
## 2026-10-07T00:05:00-05:00 — D-018 merge_pair + Settling retire + admin_settle Policy A

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | **D-018:** Lock prod ix **`merge_pair`** (not `burn_pair`; not localnet-gated) as Open-state inverse of `mint`: burn `amount` Yes+No, pay `collateral_out = amount − fee` with `fee = amount * redeem_fee_bps / 10_000` (fee-on-payout → treasury), require `vault.amount >= amount`, decrement **`pairs_minted`** (redefined while Open as outstanding pair liability: +mint / −merge). Pause blocks merge like mint/create. **Allow merge after `expiry_ts`** while `status == Open` (only status+pause matter; contrast mint's expiry gate). Event `Merged { market, user, amount, fee, pairs_minted_after }`. Distinct from `burn_losing` / `redeem`. Client: Meridian does **not** wrap Phoenix — **Buy No** = `mint` + ask Yes @ `1−p_no` (!28); **Sell No** = bid Yes @ `1−p_no` then `merge_pair` (same tx if immediate; resting = bid, merge on fill). Resolved UI 06 Buy/Sell No mechanism TODOs. **X-07:** status `1` `Settling` = unused/reserved; state machine Open → SettledYes / SettledNo / Void only. **A-05 Policy A:** `admin_settle` requires `outcome_yes == (settlement_price_e6 >= strike_price_e6)` else `OutcomeInconsistent`. |
| **Files** | `docs/SCHEMA.md` · `docs/accounts.md` · `docs/flows.md` · `programs/meridian/README.md` · `docs/ui/06-trading-intents-and-constraints.md` · `docs/DECISIONS.md` · `docs/AI_LOG.md` |
| **Related** | D-018 · Eng !28 Sell No ask · UI 06 · X-07 · A-05 · D-015 Phoenix V1 · D-014 glab |

---

## 2026-10-06T23:55:00-05:00 — Phoenix place + indexer beyond stubs (Eng)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers / Grok Bot |
| **Decision** | Land Phoenix placement path with `@ellipsis-labs/phoenix-sdk`: Buy/Sell Yes bid/ask; Buy No = mint + ask Yes @ `1−p_no`; Sell No = bid Yes only — **merge Yes+No→USDC remains Schema TODO** (no merge ix in prod IDL). Indexer: HTTP `NEXT_PUBLIC_INDEXER_URL` → RPC `StrikeMarket` GPA → fixtures+banner. Railway staging **env templates only** (no project create). |
| **SDK** | `@ellipsis-labs/phoenix-sdk@2.0.3` |
| **Gated** | Live place needs wallet + `phoenixMarket` pubkey and not `NEXT_PUBLIC_PHOENIX_ENABLED=false`; Buy No mint needs vault/mints/treasury on MarketView; seat claim via maker-setup ixs. |
| **Related** | D-014 · D-015 · SPEC §3.4 · `docs/ui/06` · branch `eng/phoenix-place-indexer` |

---
## 2026-10-06T23:55:00-05:00 — Testers: P2 + invariant gates TDD suite

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (`glab` commits API) |
| **Decision** | Land failing/pinning P2 suite on `test/p2-invariant-gates` from tip `main` (program id `9Rb7nx…`). Cases: **A-05** (prefer reject inconsistent `outcome_yes` vs price/strike; XOR accept+log + DECISIONS), **R-08** (`burn_losing`), **X-07** (Settling unused — pin or retire), **INV-P2-I3** / **INV-PROD-01** / **INV-FEE-TRUNC**. Harness adds `burnLosing`. No Rust; no Phoenix matcher; no P0/P1/SIM re-impl. |
| **Result** | Suite MR for Engineers to green (D-016). |
| **Related** | D-016 · TEST_MATRIX · !25 program-id · !16 SIM green |

## 2026-10-06T23:52:00-05:00 — SPEC lock confirmed on main (!20 @ aa97a22)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM / Grok Bot (post-merge TRACKER/AI_LOG sync) |
| **Decision** | Confirm Debu-authorized **SPEC lock** + **wireframe approval** recorded on main after !20 merge. Revise-later OK. No new DECISIONS row / no D-018. |
| **Merge** | `aa97a22b85b1ba4a85571ff8c1d15969e864b4e1` — Merge branch `docs/d012-spec-freeze` into `main` |
| **Related** | D-012 · MR !20 · TRACKER Done (SPEC + wireframes) · open !25 |

---

## 2026-10-06T23:50:00-05:00 — SPEC lock (Debu authorized; MR !20)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (lock); Grok Bot (record + merge `docs/d012-spec-freeze` !20) |
| **Decision** | **Lock** `docs/SPEC.md` (status → **Locked**). Debu authorized lock **without full review**; **wireframes approved all** (Landing/Markets/Trade/Portfolio/History under `docs/ui/wireframes/`). TRACKER: SPEC + D-012 stubs + wireframes → **Done/locked**. No new DECISIONS D-0xx invented for the freeze. |
| **History scrub** | Debu **skipped** full history scrub question. Tip-delete of committed keypair already done in !24. **Do not** force-push / filter-repo / BFG. |
| **Status at record time** | !20 **merged** onto `main` @ `aa97a22b85b1ba4a85571ff8c1d15969e864b4e1` (merge commit; head `124c074`). `docs/SPEC.md` **Locked** on main; wireframes under `docs/ui/wireframes/`. No D-018. Open residual: !25 (`test/program-id-rotate`). |
| **Related** | D-012 · MR !20 · !24 tip-delete · TRACKER SPEC Done |

---

## 2026-10-06T23:44:00-05:00 — Testers: suite points at rotated program id (!24)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (`glab` commits API) |
| **Decision** | Confirm harness/fixtures + suite docs track Engineers' program-id rotate on `main` @ `59bfdd5` (!24). **Current:** `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6`. **Revoked:** `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2`. `MERIDIAN_PROGRAM_ID` already updated in !24; Testers document gitignored keypair + localnet redeploy recipe in `tests/README.md` / fixture comment. **Do not** change Rust `declare_id!` (Engineers). |
| **Result** | Branch `test/program-id-rotate` → MR to `main`. Engineers: redeploy localnet with new keypair (pubkey must match); wipe old program accounts if validator reused. |
| **Related** | !24 `eng/sec-keypair-railway` · `keys/README.md` · D-014 |

---

## 2026-10-06T23:41:09-05:00 — SECURITY: rotate compromised program keypair + Railway IDL/health

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (eng; Debu authorized urgent land — don't wait) |
| **Branch** | `eng/sec-keypair-railway` |
| **Finding** | `keys/meridian-keypair.json` was committed → pubkey `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` treated as **compromised / revoked**. |
| **Actions** | (1) `git rm` secret key file; gitignore `keys/*` + `**/*keypair*.json` (keep `keys/README.md` pubkey-only policy). (2) **Rotate** program id to `9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6` — update `declare_id!`, `Anchor.toml`, IDL `address`, apps defaults, DEPLOY. New secret stays gitignored under `keys/meridian-keypair.json` on deploy boxes only — **never commit**. (3) Railway automation: bake `apps/automation/idl/meridian.prod.json`; default `MERIDIAN_IDL_PATH=idl/meridian.prod.json`; `/health` + `healthcheckPath`; `build:railway` strips sim. (4) Railway web: `apps/web/railway.json` + `/api/health`. (5) `emit-prod-idl.js` syncs web+automation copies; strips `MockPythParams`; `assert-idl-sync`. |
| **History scrub** | GitLab history **still contains** the old key bytes until Debu runs `git filter-repo` / BFG + force-push on `main`. This MR deletes from tree + documents revoke; does **not** force-push. |
| **Rationale** | Reviewer apps report High: committed deploy key + Railway IDL path break on `rootDirectory=apps/automation`. |

---
## 2026-10-06 23:40 CT — eng: UI nits post-!22 (`eng/ui-nits-post-22`)

**Agent:** Meridian Engineers (executor)  
**Branch:** `eng/ui-nits-post-22` from `origin/main` @ `b6540e6` (worktree `/workspace/peak6-meridian-ui-nits`)

### What landed (apps/web only — Phoenix place/cancel stubs untouched)
1. **MarketsClient** — Cards|Table|Ladder toggle; Underlying multi-select + Expiry chips; URL `view`/`u`/`expiry`
2. **MarketCard** — Buy Yes/No via `useIntentAvailability`; “You: Yes N” / “You: No N” badge
3. **TradeClient** — demo position into constraint; Zone E Position/Open orders/Fills; chart stub labeled; `?side=` kept on perspective toggle; book click → ticket price
4. **TradeTicket** — Post-only checkbox under Limit (06 §1.1)
5. **OrderBook** — `onSelectPrice` wired; bid/ask use `--bid`/`--ask` (not Yes/No accents)
6. **Hook** — `useIntentAvailability(marketId)` + demo-wiring unit tests; pure fn + tests kept
7. **Portfolio** — summary bar (USDC, uPnL, Redeem all, unsettled Phoenix); `?tab=` URL sync
8. **History** — market/date/side filters; richer columns; CSV export (fixture data)
9. **Header** — redeemable nav dot; mobile bottom tabs
10. **Global** — wrong-cluster + program-paused banners; stub `/terms` + `/risk`

### Hard constraints
- `idl/meridian.prod.json` only; no localnet-test / fixture ixs in bundle
- Did **not** touch keys/, .gitignore keys rules, railway.json, emit-prod-idl, IDL Railway copies (parallel security MR)
- Phoenix stubs left alone

### Checks
- `npm test --prefix apps/web`: 23 passed
- typecheck + lint + build: run on branch before MR

### Related
- Meridian UI review of !22 · docs/ui 02–07 · wireframes !20

---

## 2026-10-06 21:40 CT — eng: Next.js UI V1 scaffold (`eng/nextjs-ui`)

**Agent:** Meridian Engineers (executor)  
**Branch:** `eng/nextjs-ui` from `origin/main` @ `823e6fd` (new worktree `/workspace/peak6-meridian-web`; did not reuse dirty/unrelated eng worktrees)

### What landed
- `apps/web/` Next.js 14 App Router + TypeScript package consuming `docs/ui/*`
- Routes: `/`, `/markets`, `/markets/[marketId]`, `/portfolio`, `/history`, `/rules`
- Providers: Connection → Wallet → QueryClient → ChainClock → TxStatus → Pyth shell
- Solana client wraps Anchor Program from **`idl/meridian.prod.json` only** (copied into `apps/web/src/idl/`); program id `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (env-overridable)
- Wired `mint` / `redeem` builders matching prod IDL accounts; settle status read helper; create_strike left to automation
- Pure `getIntentAvailability` + Vitest covering §2.1 matrix and key §2.4 cases (16 tests)
- Trade ticket intent mapping + order book UI shell; Phoenix order placement **stubbed** (`TODO(phoenix)`)
- Markets/landing use mock fixtures when no indexer (Schema OPEN for registry)
- Portfolio redeem CTA calls `redeem` when on-chain accounts + `NEXT_PUBLIC_USDC_MINT` present; fixtures explain stub
- `.env.example` with `NEXT_PUBLIC_*` only; README + root scripts `web:dev` / `web:build` / `web:test` / `web:typecheck`
- TRACKER: Next.js UI moved Todo → In Progress

### Hard constraints honored
- No `localnet-test` / mock Pyth / `sim_*` / `test_drain_vault` in web source or prod bundle
- Anchor program / tests untouched
- Did not invent Schema TODOs as on-chain facts

### Checks
- `npm test` (apps/web): 16 passed
- `npm run typecheck` / `lint` / `build`: green

### Stubbed / follow-ups
- Full Phoenix SDK place/cancel/seat
- Indexer-backed market registry, history, cost basis
- Live Pyth Hermes subscription
- Real on-chain position balances (demo fixtures for SSR)

---

## 2026-10-06T21:35:00-05:00 — Node automation dual-mode (calendar ET + sim)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/node-automation`) |
| **Decision** | Land Railway-ready `apps/automation` with **dual mode (D-017)**: (1) **calendar** worker — morning `create_strike_market` (~08:00 America/New_York) + optional `set_phoenix_market`, settle retries with real Pyth after ≥16:00 ET, `admin_settle` only with authority after delay/retries; (2) **sim** — separate `sim-lifecycle` entry, localnet-only, `sim_open_session`/`sim_close_session` + mock Pyth. Prod entry loads **`idl/meridian.prod.json` only**; client refuses fixture IDL off localnet. Sim module never imported by worker. Phoenix market create stubbed (TODO); strikes = prior-close ± offsets placeholder. Docs: `SIM_LIFECYCLE.md`, DEPLOY §4 pointer, TRACKER automation items → In Progress. |
| **Result** | Package + unit tests (ET gates, mode isolation, strike encoding). MR open — do not merge until review. |
| **Related** | D-014 · D-017 · DEPLOY !18 · SIM !16 · TRACKER automation todos |

---

## 2026-10-06T21:30:00-05:00 — D-012 SPEC freeze candidate + remaining stubs (Meridian PM)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM; Grok Bot (`docs/d012-spec-freeze`) |
| **Decision** | Land freeze-ready `docs/SPEC.md` (status: **Freeze candidate**, awaiting Debu lock ping) plus remaining D-012 artifacts: AGENTS, ARCHITECTURE, TASKS, DEMO_SCRIPT, EVALS, METRICS, RED_TEAM, DIAGRAMS, CONTEXT, CLAUDE, ORCHESTRATOR_KICKOFF. Root README gains Docs map. TRACKER: SPEC moved from “not ready” → freeze candidate In Progress; D-012 stubs Done; Railway noted as prod app/automation target; !19 already on main. No new DECISIONS row — SPEC freeze candidate landed; Debu lock pending (prefer AI_LOG/TRACKER over inventing D-018). |
| **Constraints honored** | GitLab-only + glab (D-014); Phoenix V1 spot (D-015); TDD (D-016); Anytime sim hard acceptance (D-017); no regulatory claims; Todo/In Progress/Done only. |
| **Related** | D-012 · D-014…D-017 · DEPLOY Railway · MR !19 already merged |

---

## 2026-10-06T21:26:00-05:00 — Landed !14–!18 on main (glab merge order)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (glab; Debu-authorized land) |
| **Decision** | Strict merge order: !14 SimClock docs → !15 SIM suite → !16 SIM green → !17 Reviewer nits → !18 CI+DEPLOY. Rebased each onto current `main` (force-with-lease) when behind; merged via `glab mr merge --auto-merge=false` (CI runners may be absent). Localnet suite already reported **60/60** on !16. |
| **Merge SHAs** | !14 `b5a82a426016` · !15 `e2305976de0c` · !16 `84b8d67d0fb7` · !17 `5246e4137568` · !18 `28efa3865f13` |
| **TRACKER** | Synced post-land; `SPEC.md` still **not ready**. |
| **Related** | D-014 · D-017 · MRs !14–!18 |

---

## 2026-10-06T20:20:00-05:00 — CI + DEPLOY ladder (Railway / localnet→devnet→prod)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/ci-deploy`) |
| **Decision** | Land `.gitlab-ci.yml` (`prod-build-no-fixtures` + `localnet-anchor-test` with Solana/Anchor cache) and `docs/DEPLOY.md` describing Debu's ladder: localnet (box+CI) → devnet staging (prod build, real Pyth/Phoenix) → Railway staging→devnet → Railway prod. Railway runs Next.js + Node automation only; program deploys on-chain separately. **Forbidden:** `--features localnet-test` on devnet/mainnet. Includes Reviewer deploy checklist + prod IDL/`.so` fixture assert scripts. |
| **Result** | Branch + MR for ops/CI contract. Runner availability on `labs.gauntletai.com` may be none — YAML still lands. |
| **Related** | Reviewer-nits !17 · SIM !16 · D-017 |

## 2026-10-06T20:10:00-05:00 — Reviewer nits: real Pyth prod path + fee caps + prod IDL

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (`eng/reviewer-nits-pyth-idl`) |
| **Decision** | Land Reviewer approve-with-nits on main @ 14d6928: (1) **HIGH** settle decoder — `load_pyth_price` mock under `localnet-test` only; prod parses legacy Pyth Price magic `0xa1b2c3d4` and **rejects** mock magic. (2) **MEDIUM** `idl/meridian.prod.json` via `scripts/emit-prod-idl.js` + `scripts/assert-prod-no-fixtures.sh` (`yarn build:prod`). (3) **MEDIUM** `update_config` fee cap `MAX_FEE_BPS=1000`; prod-only timelock `CONFIG_TIMELOCK_SECS=3600` + min admin delay 60s (`#[cfg(not(feature = "localnet-test"))]`); localnet suite unchanged. (4) Redeem `user_collateral_ata` mint == `config.collateral_mint`. Deploy forbid note in program README — full ladder in follow-up `eng/ci-deploy`. |
| **Result** | `anchor test -- --features localnet-test`: **51/51**. Prod `.so` + prod IDL assert: no fixture strings. |
| **Related** | Review report `/workspace/meridian-review-main-14d6928.md` · SIM eng !16 · D-017 |

## 2026-10-06T20:10:00-05:00 — Testers nits on MR !16 (SIM expiry + header)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (push `eng/sim-session` → !16) |
| **Decision** | Approve-with-nits: (1) SIM-06/07 expiry buffers **+20s** (match SIM-05/08; create/simOpen race). (2) Refresh `tests/sim_session.ts` header — no longer TDD_RED; documents GREEN eng fixtures + localnet-only gate. Optional: CI prod `.so`/IDL fixture strings gate already in **MR !18** (`eng/ci-deploy`); `build:prod` / `deploy:build` = `anchor build` (no features) only. |
| **Result** | `anchor test -- --features localnet-test`: **60 passing / 0 failing**. |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/16 |

---

## 2026-10-06T19:55:00-05:00 — Eng green Cluster G sim session (SIM-01…09)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab on `eng/sim-session`) |
| **Decision** | Green Testers MR !15 suite: `sim_open_session` / `sim_close_session` under `#[cfg(feature = "localnet-test")]`; `StrikeMarket.trading_open` (default **true** on create) + `sim_armed` (set by sim_open so P0/P1 settle-without-close stays green; SIM-05 SessionNotClosed only after sim_open). Errors `TradingClosed` / `SessionNotClosed`. Mint gates on `trading_open`. Sim trade = harness off-book Yes SPL transfer (no Meridian matcher). Prod `.so` omits `sim_*` (verified). SIM-05/08 expiry buffers +20s (create+simOpen race; assertions unchanged). SimClock PDA deferred (!14) — not required by SIM cases. |
| **Result** | `anchor test -- --features localnet-test`: **60 passing / 0 failing** (51 P0/P1 + 9 SIM). |
| **Related** | Testers !15 · Schema !14 (docs only, not required) · D-017 · Reviewer nits follow-up |

---

## 2026-10-06T19:32:00-05:00 — Testers: localnet sim session lifecycle TDD (SIM-01…SIM-09)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (glab land) |
| **Decision** | Extend TEST_MATRIX Cluster G + failing `tests/sim_session.ts` (SIM-01…SIM-09) for **localnet-only** simulated open→trade→close→settle→redeem (D-017). Harness hooks `simOpen` / `simClose` / `simTradeOffBook` throw **TDD_RED** until Eng lands `sim_*` under `localnet-test`. Sim trade = mint + off-book Yes SPL transfer (Phoenix placeholder) — **no** Meridian matching engine. Negatives: mint after close; settle before close. Distinct from mainnet; never gate prod builds. |
| **Result** | Branch `test/sim-session-lifecycle` → MR to `main`. Engineers implement **only** to green. |
| **Related** | D-016, D-017, MR !5–!11 |

## 2026-10-06T19:30:00-05:00 — D-017 SimClock / effective_clock for localnet market open-close (Meridian Schema)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | **D-017:** Simulate mint-window open/close without wall-clock waits. No new `StrikeMarket` status for session hours — lifecycle stays `Open` → `SettledYes|SettledNo|Void`. Meridian "market open" = `status==Open && !paused && effective_now < expiry_ts`; "close" = `effective_now >= expiry_ts`. Add **SimClock** PDA seeds `["sim_clock"]` (`authority`, `unix_timestamp`, `slot`, `enabled`, `bump`); authority = `Config.authority`. Ixs `init_sim_clock` / `set_sim_clock` / `warp_sim_clock` / optional `disable_sim_clock` all `#[cfg(feature = "localnet-test")]` (same deploy-blocker pattern as mock Pyth). Time gates on mint/settle/admin_settle (+ Pyth `slot_now`) use **`effective_clock`**; prod builds use `Clock::get()` only. Preferred Anchor shape: `sim_clock: Option<Account<SimClock>>` under localnet-test. `settled_at_ts`/`settled_slot` record effective values. Event `SimClockSet`. Pause unchanged. Full proposal: [`sim-clock.md`](sim-clock.md). |
| **Result** | Schema docs updated: `docs/sim-clock.md` created; SCHEMA / accounts / flows / programs README / DECISIONS / AI_LOG aligned. Engineers implement behind `localnet-test`. |
| **Related** | D-017 · D-014 · D-016 · localnet fixtures (upsert_mock_pyth, test_drain_vault) |


---

## 2026-10-06T19:30:38-05:00 — D-017 Anytime open/close/settle simulation (V1 hard acceptance)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash + Meridian PM (lock); Grok Bot (record + TRACKER/DLV sync) |
| **Decision** | Lock **anytime market open/close/settle simulation** as a **V1 hard acceptance** requirement (**D-017**). Acceptance: E2E **create → mint → Phoenix trade → settle → redeem** in one continuous run with **no wait** for real US equity **9:30 / 4:00 ET**. Harness drives simulated **Open** and **Close**; forces **YesWins / NoWins** at known prices; real Pyth reject paths (stale / wide conf) remain testable. Prod/devnet keep real **≥4:00 PM ET** settle gate + Pyth quality; sim controls hard-gated (test feature / local validator / Config flag) and **must not weaken** production invariants. Ship documented one-command/scripted sim lifecycle in-repo alongside calendar automation. UI sim affordance **optional** for V1. Phoenix V1 spot working assumption (D-015); official land path = `glab` (D-014). |
| **Rationale** | PM + Debu need continuous demo/CI lifecycle without wall-clock equity hours; production settle/oracle invariants stay intact behind hard gates. |
| **TRACKER** | Add In Progress / Todo for sim harness, dual-mode automation, Tester E2E sim cases. `SPEC.md` still **not ready**. |
| **Related** | D-005, D-014, D-015, D-016 |

---

## 2026-10-06T17:14:55-05:00 — Testers nits on MR !11 (feature-gate fixtures + stack)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab on `eng/p1-fees`) |
| **Decision** | Approve-with-nits on !11: (1) **Stack:** MR !9 still open — merged `origin/main` into `eng/p1-fees` (`e38b57b`); branch retains `eng/p0-anchor-impl` ancestry so !11 stays clean relative to !9. **Merge-order dependency:** land !9 before !11 (or rebase after !9 merges). (2) **Deploy blockers:** `test_drain_vault` + `upsert_mock_pyth` gated `#[cfg(feature = "localnet-test")]` on modules + entrypoints; Cargo feature `localnet-test`; `idl-build` enables it for IDL typecheck only. Prod `anchor build` .so omits fixture symbols; localnet `anchor build -- --features localnet-test` includes them. `package.json` `test` / `build:localnet` / `build:prod` scripts. (3) Optional: mint/redeem `treasury` constrained `address = config.treasury`. |
| **Result** | `anchor test -- --features localnet-test`: **51 passing / 0 failing**. Prod .so verified: fixture ix names **absent**. |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/11 |
| **Related** | Testers !10 · eng P0 !9 · D-016 |

---

## 2026-10-06T17:05:00-05:00 — Eng P1 fees + edges green (MR !10 suite)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers; Grok Bot (glab land) |
| **Decision** | Branch `eng/p1-fees` from Testers `test/p1-fees-failing` (MR !10 @ P0 tip `6618d74`). Fee paths already fee-on-transfer-in (SCHEMA §7.3) — **M-03 / R-05 / V-06** green without P0 fee=0 weakening. Edges **S-08, X-03, M-07, M-09, M-10, V-08** green on existing program. **V-07:** landed localnet-only `test_drain_vault` fixture + harness `drainVault` to prove `InsufficientVault` (never unbacked payout). |
| **Result** | `anchor test`: **51 passing / 0 failing**. Depends on / stacks with MR !9 (P0). |
| **Related** | Testers suite MR !10 · eng P0 MR !9 · D-016 |

---


## 2026-10-06T16:55:00-05:00 — Testers P1 fees failing suite (TDD)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Testers; Grok Bot (glab commits API, no clone) |
| **Decision** | Land P1 TDD suite on `test/p1-fees-failing` from `eng/p0-anchor-impl` @ 6618d74 (nits verified). Core fees **M-03 / R-05 / V-06** in `tests/fees.ts`; invited edges **S-08, X-03, M-07, M-09, M-10, V-07, V-08** in `tests/p1_edges.ts`. Harness always re-applies fee bps on config reuse so P1 cannot poison P0 fee=0. **V-07** stays `TDD_RED` (no vault-drain fixture). No Rust fee logic in this MR. |
| **Result** | Branch + MR → `main` (same base as open !9). Engineers rebase after !9; implement **only** to green remaining reds. Do not weaken P0. |
| **Related** | MR !9 (P0 eng), matrix !5, D-016 |

---

## 2026-10-06T16:50:00-05:00 — Testers nits on MR !9 (R-02 / S-11 / I4 / events)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (follow-up); Grok Bot (glab push to `eng/p0-anchor-impl`) |
| **Decision** | Land Testers approve-with-nits on MR !9 before P1 fees suite: (1) **R-02** assert SettledNo → redeem(Yes) → `InvalidWinningMint` (program already enforced; test gap closed); (2) **S-11** assert Yes/No supplies unchanged across settle (SCHEMA §5.4); (3) optional I4 field snapshots on S-09/A-04; (4) optional event listeners on S-01/A-01/R-01 (`settled` / `adminSettled` / `redeemed`). |
| **Result** | `anchor test`: **41 passing / 0 failing**. No suite weakening. Ready for Testers P1 fees (M-03 / R-05 / V-06). |
| **MR** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/9 |

---


## 2026-10-06T16:35:00-05:00 — Eng P0 Anchor impl greens Testers suite (Meridian Engineers / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Engineers (impl); Grok Bot (orchestrate; glab land path D-014) |
| **Decision** | Land `eng/p0-anchor-impl` → `main`: full `programs/meridian` Anchor program (initialize/pause/create/mint/settle/admin_settle/redeem/set_phoenix + localnet `upsert_mock_pyth` fixture), regenerated IDL, bankrun-free harness on `solana-test-validator`, P0 case IDs from Testers MR !6 kept in `it()` titles. Includes TEST_MATRIX from MR !5. |
| **Result** | `anchor test`: **41 passing / 0 failing** (~3m). Covers all **37 P0 case IDs** (M/S/A/R/V/X + S-10 unit vectors). Phoenix = pubkey wiring only (D-004/D-015). Pyth = MockPythPrice gates (staleness 150, conf 500 bps, settle ≥ strike) per D-005. |
| **Program id** | `GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2` (localnet placeholder; replace at deploy) |
| **Related** | MR !5 (matrix), MR !6 (failing suite), D-016 TDD |

---

## 2026-10-06T16:04:00-05:00 — TDD mandate for core program invariants (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (mandate); Grok Bot (record + enforce for Engineers/Testers) |
| **Decision** | **TDD is mandatory** for Meridian program work. Write **failing tests first**, then implement, for these core paths/invariants: **vault $1** collateralization (vault covers outstanding pairs at $1 USDC per pair), **mint**, **settle**, **redeem**, and **pause**. Do not ship implementation ahead of red tests for these. |
| **Rationale** | Locks engineer workflow to prove vault/mint/settle/redeem/pause behavior before green code; reduces silent invariant breaks on the platinum demo path. See **D-016**. |
| **Applies to** | Anchor program (`programs/meridian`), Tester plans, Reviewer gates |

---

## 2026-10-06T15:52:00-05:00 — Unblock: glab official land path; Phoenix V1 spot assumed (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (decision); Grok Bot (record + enforce) |
| **Decision** | **Cursor enterprise GitLab + MCP GitLab 404 are NOT blockers.** Official SCM land path = **`glab`** against `labs.gauntletai.com` (`GITLAB_HOST=labs.gauntletai.com`, existing `glab` auth / `GAUNTLET_GITLAB_TOKEN`). **Phoenix V1 spot** is the **working assumption** (confirmation widget skipped — do not invent a separate Debu confirm). Reword prior “blocker” language accordingly; ship via branch `docs/unblock-glab-path` + MR. |
| **Rationale** | CloudAgent/MCP gaps are tooling preferences, not program stalls. Schema/UI already land via `glab`; treat that as the sanctioned path. Spot assumption unblocks Engineers without a confirmation widget. See D-014 / D-015. |
| **Supersedes** | Framing in the 15:40:30 “Tooling blockers” entry and D-011 “blocked” wording; Phoenix V1 spot “OPEN / do not treat as confirmed” caution → working assumption (D-015). |

---

## 2026-10-06T15:48:00-05:00 — UI design slice MR (Meridian UI)

| Field | Value |
| --- | --- |
| **Actor** | Meridian UI |
| **Decision** | Open MR `ui/docs-slice` → `main` with engineer-ready UI specs under `docs/ui/` (Landing, Markets, Trade, Portfolio, History + intents/constraints + IA/routes). Append this log entry on `main` (Schema MR !1 already merged; `schema/docs-slice` gone) so AI_LOG stays single-threaded with Schema. |
| **Rationale** | Parallel UI slice; land via `glab` API on labs.gauntletai.com (same as Schema). Cursor CloudAgent/MCP unavailable — **not blockers** (see 15:52 / D-014). |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/2 |
| **Commit** | `a3c5a63d` |

Key UI locks in this slice: one Phoenix Yes/USDC book with No as display transform; four intents (Buy/Sell × Yes/No); trading UI blocks simultaneous Yes+No exposure (balances + open buys + in-flight); settlement countdown component; payoff copy "1.00 USDC if right, 0 if not". Open `TODO(schema)` / `OPEN:` tags remain in the docs.

---

## 2026-10-06T15:46:00-05:00 — Orchestration log completeness (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Append full orchestration history to this file on branch `schema/docs-slice` (MR !1); expand `DECISIONS.md` locks; do **not** open a second MR or push a parallel AI_LOG to `main` |
| **Rationale** | Schema already landed `docs/AI_LOG.md` + `DECISIONS.md` via MR !1. A parallel main commit would fork the log. Completeness + security ownership requires one append-only narrative covering repo, stack, agents, tooling notes, open assumptions, and required docs. |

---

## 2026-10-06T15:45:55-05:00 — Schema MR !1 opened (Meridian Schema / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema (commit); Grok Bot (orchestrate) |
| **Decision** | Open MR !1 `schema/docs-slice` → `main`: schema docs + companion units/accounts/flows + scaffold map + initial AI_LOG/DECISIONS |
| **Rationale** | Land schema slice for review without blocking `main` README; keep forge on Gauntlet Labs GitLab only. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian/-/merge_requests/1 |
| **Commit** | `8578ea4` — `docs(schema): Anchor layouts, Phoenix/Pyth linkage, units, flows` |

---

## 2026-10-06T15:42:00-05:00 — Schema drafted locally (Meridian Schema)

| Field | Value |
| --- | --- |
| **Actor** | Meridian Schema |
| **Decision** | Draft on-chain schema docs locally under `/workspace/meridian-schema-docs` before API commit to GitLab: `SCHEMA.md`, `accounts.md`, `flows.md`, `units.md`, `programs/meridian/README.md` |
| **Rationale** | Local draft → `glab`/API push to `schema/docs-slice` is the sanctioned land path (CloudAgent/MCP optional; **not blockers** — see 15:52 / D-014). UI work proceeds in parallel under `/workspace/meridian-ui-specs` (to be committed as `docs/ui/`). |

---

## 2026-10-06T15:41:00-05:00 — Required docs artifacts list (Debu → Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (requirement); Grok Bot (track) |
| **Decision** | Track and eventually ship these docs artifacts in-repo (names as given): |

| Artifact |
| --- |
| `AGENTS` |
| `AI_LOG` |
| `ARCHITECTURE` |
| `CLAUDE` |
| `CONTEXT` |
| `DECISIONS` |
| `DEMO_SCRIPT` |
| `DEPLOY` |
| `DIAGRAMS` |
| `EVALS` |
| `METRICS` |
| `ORCHESTRATOR_KICKOFF` |
| `README` |
| `RED_TEAM` |
| `SPEC` |
| `TASKS` |
| `TRACKER` |

| Field | Value |
| --- | --- |
| **Rationale** | Platinum deliverable set for Peak6 / Gauntlet; AI usage log (`AI_LOG`) is mandatory. Schema MR seeds `AI_LOG` + `DECISIONS` + schema companions; remaining stubs/docs are follow-on tasks. |

---

## 2026-10-06T15:40:30-05:00 — Tooling note (historical): CloudAgent + MCP GitLab (Grok Bot) — NOT blockers (see 15:52 / D-014)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot |
| **Decision** | Prefer box-local draft + `glab` / GitLab REST with `GITLAB_HOST=labs.gauntletai.com` and `GAUNTLET_GITLAB_TOKEN`. Cursor CloudAgent (enterprise host not in Settings) and MCP GitLab (**404**) are **unavailable conveniences — not program blockers**. Official land path = `glab` (confirmed 15:52 / D-014). |
| **Rationale** | CloudAgent is not configured for `labs.gauntletai.com`; MCP GitLab returns **404**. Those gaps do **not** stall Meridian — `glab` works and is the official land path. (Superseding “blocker” framing: see 15:52 entry / D-014.) |

---

## 2026-10-06T15:40:00-05:00 — Specialist agents spawned (Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Grok Bot (chief orchestrator) |
| **Decision** | Create six Meridian specialist agents; Grok Bot remains chief of staff / chief orchestrator owning **completeness** and **security** across slices. |

| Specialist | Role |
| --- | --- |
| Meridian PM | Requirements, acceptance criteria, prioritization, trade-offs |
| Meridian Schema | Anchor accounts, PDAs, events, units, automation shapes |
| Meridian UI | Next.js IA / wireframes: Landing, Markets, Trade, Portfolio, History |
| Meridian Engineers | Anchor/Rust, Next.js/TS, Node automation, Phoenix + Pyth + USDC |
| Meridian Testers | Unit/integration/frontend plans; invariant gates; lifecycle scenarios |
| Meridian Reviewers | Architecture, security (non-custodial, pause, admin delay), docs/AI_LOG, demo readiness |

| Field | Value |
| --- | --- |
| **Rationale** | Parallel Schema + UI slices need clear ownership; Engineers/Testers/Reviewers consume PM + Schema + UI outputs. Grok Bot does not replace specialists — orchestrates, enforces GitLab-only forge, and owns end-to-end completeness + security. |
| **Repo constraint (all agents)** | https://labs.gauntletai.com/debudash/peak6-meridian only — never GitHub / Origin. |

---

## 2026-10-06T15:39:30-05:00 — PM V1 acceptance bar, non-goals, parallel slices, Phoenix spot assumption (Meridian PM / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM (bar); Grok Bot (orchestration) |
| **Decision** | Adopt V1 acceptance bar + non-goals; run **Schema** and **UI** as parallel slices; treat **Phoenix V1 spot** as the working assumption (confirmation widget **skipped** — later confirmed as D-015 / 15:52). |

### V1 acceptance bar (minimum)
- Non-custodial dApp: mint Yes/No pairs vs USDC, trade on Phoenix Yes/USDC book, settle via Pyth ~4:00 PM ET, redeem winners 1:1 USDC
- MAG7 0DTE binary markets; Yes + No payout identity = $1 USDC; vault covers outstanding pairs
- On-chain: Config, Create Strike Market, Mint, Settle, Admin Settle (delayed), Redeem, Pause/Unpause
- Frontend surfaces: Landing, Markets, Trade, Portfolio, History
- Stack: Solana + Anchor, Phoenix (integrate), Pyth, USDC; Next.js/TS frontend; Node/TS automation
- Core submission: **never mainnet**
- Docs/demo: source + tech docs + demo + deploy guide + test results + AI usage log

### Non-goals (V1)
- Custom matching engine / home-grown CLOB
- Multi-collateral
- Inventing regulatory/compliance claims
- On-chain code in the schema docs slice (scaffold map only)
- Phoenix spot confirmation widget / invented Debu confirmation of spot wiring

### Working assumption — Phoenix V1 spot (locked as assumption in D-015)
- **Assumption:** V1 uses Phoenix **spot** markets (Yes base / USDC quote) as Schema defaulted.
- **Status:** **WORKING ASSUMPTION** (Debu / Grok Bot, 15:52) — confirmation widget **skipped**; do not invent a separate confirm. Schema/UI/Engineers proceed on spot. Revisit only if Debu explicitly changes product direction.

| Field | Value |
| --- | --- |
| **Rationale** | Unblocks parallel Schema/UI without inventing product confirmation; keeps risk visible in AI_LOG. |

---

## 2026-10-06 — Schema slice defaults (Meridian Schema)

**Agent:** Meridian Schema  
**Repo path:** `docs/SCHEMA.md` (+ companions)  
**Status:** Proposed on branch `schema/docs-slice` (land via MR !1)

### Locked defaults
| Decision | Choice | Rationale |
| --- | --- | --- |
| Price / strike / settlement / Yes price scale | `PRICE_SCALE = 1_000_000` (1e6) | Align with USDC + outcome mint decimals (6) |
| Phoenix base mint | Yes outcome mint | Single Yes/USDC book; UI maps No via inverse |
| Phoenix quote mint | Collateral (USDC) | Standard CLOB quote |
| Custom matching | **Do not build** — integrate Phoenix only | Stack lock |
| Pyth max staleness | 150 slots | Settle gate |
| Pyth max confidence ratio | 500 bps (5%) | Reject noisy prints |
| Yes wins if | `settlement_price_e6 >= strike_price_e6` | Inclusive touch |
| Binary payout | $1 USDC per winning token | Vault covers outstanding pairs |
| Protocol fees | Fields present; default **0 bps** | Can enable later without layout change |
| Pause behavior | Blocks mint/create; settle+redeem still allowed | Protect LPs / resolution |
| Forge | Gauntlet Labs GitLab only (`labs.gauntletai.com/debudash/peak6-meridian`) | No GitHub/Origin |

### Accounts / instructions / events (summary)
- Accounts: `Config`, `StrikeMarket`, vault authority PDA, Yes mint, No mint
- Instructions: create market, mint, settle, admin_settle, redeem, pause, set_phoenix_market
- Events: MarketCreated, Minted, Settled, Redeemed (+ config/pause updates as needed)

### Open questions (see SCHEMA.md §8)
1. Phoenix base side (Yes vs No) — default Yes pending PM/UI confirm
2. Exact MAG7 Pyth feed ids / price accounts
3. `>=` vs `>` on strike
4. `equity_symbol` `[u8;8]` vs AssetRegistry PDA
5. StrikeMarket PDA seeds `(symbol, expiry, strike)` vs `market_id` only
6. Whether v1 includes `burn_losing`
7. Fee policy beyond 0 bps defaults
8. Settle-window policy vs automation retries
9. Multi-collateral — out of scope for v1
10. **Phoenix V1 spot** — **working assumption** (D-015); widget skipped; not a blocker (see 15:52)

### Non-goals this slice
- No Anchor program source yet (scaffold map only under `programs/meridian/`)
- No custom CLOB
- No frontend work (parallel track)

---

## 2026-10-06T15:33:45-05:00 — Stack lock + GitLab-only mandate (Debu / Grok Bot)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash (lock); Grok Bot (enforce for all agents) |
| **Decision** | **Stack:** Solana + Anchor (Rust); **CLOB:** Phoenix (integrate existing — do not build matching); **Oracle:** Pyth equity closes. **Forge:** Gauntlet Labs GitLab **ONLY** — `https://labs.gauntletai.com/debudash/peak6-meridian`. Never GitHub, never Cursor Origin remotes for Meridian source of truth. |
| **Rationale** | Matches Peak6 / Gauntlet private platinum brief; Phoenix + Pyth are preferred integrations; multi-forge would desync agents and leak private work. |

---

## 2026-10-06T15:33:33-05:00 — Private repo created (Debu)

| Field | Value |
| --- | --- |
| **Actor** | Debu Dash |
| **Decision** | Create private project `debudash/peak6-meridian` on `labs.gauntletai.com` (default branch `main`, initial README only). |
| **Rationale** | Single private forge for Meridian (Peak6) agent + human collaboration. |
| **URL** | https://labs.gauntletai.com/debudash/peak6-meridian |
| **Commit** | `4e449f8` — `Initial commit` |

---

## 2026-10-06T21:32:00-05:00 — SPEC freeze includes UI wireframes on !20 (Meridian PM)

| Field | Value |
| --- | --- |
| **Actor** | Meridian PM |
| **Decision** | Debu: UI wireframes must land **in SPEC freeze MR !20** (branch `docs/d012-spec-freeze`), **not** a separate MR. SPEC §3.10 + §8 updated; `docs/ui/wireframes/` slot + README for Meridian UI pushes; TRACKER In Progress updated. |
| **Rationale** | Single freeze package: product SPEC + visual contract for five V1 pages before Debu lock ping. |
| **Related** | D-012 · MR !20 · `docs/ui/` |

