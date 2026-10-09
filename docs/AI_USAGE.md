# AI usage log

How AI was used to build Meridian, who decided what, and how AI output was checked. The full chronological record (every slice, MR and decision with timestamps) is [`internal/AI_LOG.md`](internal/AI_LOG.md); this page summarises it.

## 1. Tools and roles

The work ran in two phases.

| Phase | Period | Tool | Role |
| --- | --- | --- | --- |
| 1 | 2026-10-06 to 2026-10-08 ~14:30 CT | **Grok Bot** (orchestrator agent) | Chief of staff: split work into slices, briefed specialist agents, enforced the land path and locks, owned completeness and security (D-008) |
| 1 | same | Specialist agents spawned by Grok Bot (D-009) | **PM** (SPEC, acceptance, tracker) · **Schema** (accounts, instructions, units, flows) · **UI** (page specs, wireframes) · **Engineers** (Anchor program, Next.js app, Node automation, ops scripts) · **Testers** (test matrix, failing suites first, test plans) · **Reviewers** (security and architecture reviews, demo readiness) |
| 2 | 2026-10-08 onward | **Claude Code** (Anthropic, Opus 5.5) | Took over after Debu stopped the Grok agents. Coding, ops and docs agent working in git worktrees under the same rules |
| Both | Throughout | **Debu Dash** (human owner) | Product and risk decisions, locks, approvals, merges, hands-on testing |

All work landed through merge requests on the project's GitLab (D-001, D-014).

## 2. Working model

1. **Spec first.** PM / Schema / UI agents wrote SPEC, SCHEMA and UI specs; Debu locked SPEC on 2026-10-06 (MR !20).
2. **Failing tests first.** Testers wrote red suites before any implementation for vault $1, mint, settle, redeem and pause (D-016, Debu's mandate). Example: the P0 suite (MR !6, 37 cases) went red → green in the Engineers' MR !9.
3. **One slice per MR.** Engineers implemented only to green; each MR states branch, tests run and results.
4. **AI review.** Reviewer agents reviewed security-sensitive and deploy-ladder MRs and wrote findings by severity (High / Medium / Low). Fixes came back as follow-up MRs with their own tests.
5. **Human decision.** Debu (or Grok Bot on an explicit instruction from Debu) decided scope, accepted or declined review findings, and merged.
6. **Record.** Each slice appended an entry to `AI_LOG.md` and moved its tracker card; durable decisions became rows in [`DECISIONS.md`](DECISIONS.md).

**Phase 2 (Claude Code, from 2026-10-08).** The same steps, run this way:

- Background subagents did the larger pieces of work: the D-026 create-by-08:00 change (!93), the docs refactor (!95) and repo mapping.
- An independent review subagent reviewed every MR before merge. Its findings were fixed in the same MR (e.g. D-026 review M1 / M2, !95 review M1–M3).
- The Docker toolchain (!94) was the local merge gate, because the project has no CI runners.
- Debu approved every merge and made the decisions: markets created by 08:00 ET on the prior close (D-026), operator prices while Hermes lacked equities (now only a fallback, D-027), a new program id instead of recovering the lost one (DLV-124), the demo URL, and the cut line for the submission.

## 3. What the human decided vs what agents did

| Debu decided | Agents did |
| --- | --- |
| Stack and forge: Solana + Anchor, Phoenix (integrate, do not build), Pyth, USDC; GitLab only (D-001, D-002) | Wrote the program, web app, automation and ops scripts |
| TDD mandate (D-016) and anytime-sim as hard acceptance (D-017) | Wrote the test matrix and the red suites, then the code to green them |
| Locked SPEC and approved the wireframes (MR !20) | Drafted SPEC, schema and UI specs and wireframes |
| Phoenix V1 spot as a working assumption, no extra confirmation step (D-015) | Wired one Yes/USDC book per strike and mapped four intents onto it |
| Product simplifications: hide post-only (D-021); "anything selected must be clearly highlighted" (D-022) | Implemented and tested them |
| Declined a git-history rewrite after the committed-keypair finding | Rotated the program id and removed the key from the tree |
| Approved operator-sourced prices with a logged source while the Hermes key lacked equities (fallback only since 2026-10-09, D-027); one market creator (worker, not the box) | Built `ops/operator-prices.cjs`, the source-required checks and the creator switch |
| Flagged issues from hands-on use (e.g. could not place an order on localnet; markets expiring days later instead of today; no SOL balance shown on Portfolio) | Root-caused and fixed them with tests (DLV-066, DLV-118, DLV-125) |
| Phase 2: create by 08:00 ET on the prior close (D-026); a new program id (DLV-124); 60 s staging `admin_settle` delay (DLV-123); demo URL; what is cut for the submission (DLV-121, DLV-122, DLV-069, mainnet items) | Implemented, reviewed, deployed to devnet and documented them |

## 4. How AI output was verified

- **TDD:** failing tests first on every core path; suites must stay green before merge.
- **Reviewer agents:** separate agents with a security brief reviewed MRs; findings tracked to closure (e.g. review "mr72-73" M1–M3, "!91" M-1 and L-1…L-9).
- **Local gates:** labs GitLab has no CI runners for this project, so the merge gate is local. Since !94 it is the Docker toolchain (Agave 4.3.0): every suite, `tsc`, lint and the prod fixture assert, with counts recorded in the MR and the log ([`TEST_RESULTS.md`](TEST_RESULTS.md)).
- **Independent review before merge (phase 2):** a separate review subagent read each diff before Debu merged it.
- **Real-system checks:** real Phoenix V1 and Seat Manager programs loaded into a local validator; prod `.so` tested in LiteSVM with real devnet and mainnet Pyth account bytes; a dry run of the prod build against cloned devnet accounts.
- **Hardening passes:** end-to-end, UI smoke and security sweeps on 2026-10-07 ([`TEST_RESULTS.md`](TEST_RESULTS.md)).
- **Human testing:** Debu clicked through the app on localnet; manual runbooks for localnet and devnet.

## 5. Notable AI mistakes caught and fixed

| Mistake | How it was caught | Fix |
| --- | --- | --- |
| Phoenix order size sent in atoms instead of whole tokens (10⁶× too large). A Reviewer agent had signed this off as correct | Placing real orders against Phoenix V1 on localnet after Debu could not trade | D-020 records the correction; `size.test.ts` rewritten (DLV-066) |
| Prod settle decoded the legacy Pyth push layout, which real equity feeds no longer use (`InvalidPythAccount`) | Dry run of the prod `.so` against cloned devnet accounts | Pull-oracle settle (D-025), 21 then 22 LiteSVM cases on the prod binary |
| A program keypair was committed to git | Reviewer agent report (High) | Key revoked, program id rotated (`GwTvo…` → `9Rb7nx…`, 2026-10-06), `keys/*` gitignored ([`keys/README.md`](../keys/README.md)). A second rotation followed on 2026-10-08 (`9Rb7nx…` → `3X3E…`, DLV-124) because the replacement keypair existed only on the old build box. |
| A production build with localnet env served the dev-wallet secret key; spoofed `Host` headers also reached it | Hardening security sweep | Dev wallet impossible in production builds; loopback-only checks, including a self-probe of the server's own interfaces (DLV-080, DLV-081) |
| React hydration errors on every trade page load (inline `<style>` escaped by SSR) and on countdowns | Hardening UI smoke on a production build | CSS moved to `globals.css` with a guard test; server time passed to the clock provider (DLV-079, DLV-086) |
| Buy No could mint and then under-fill, leaving the user with Yes + No; a 0-fill showed "Submitted" | Hardening real-Phoenix E2E | Market orders made fill-or-kill (D-024) |
| Web silently showed sample (fixture) markets on any cluster when RPC failed | Devnet staging dry run | Fixtures only on localnet with a loopback RPC (DLV-084, DLV-092) |
| Daily markets expired days later, not at today's close, against SPEC | Debu, from the UI | Shared same-day market rule with DST, holidays and early closes (DLV-118, DLV-119) |
| Docs called the pauser key "low privilege"; it is a full Seat Manager authority | Reviewer agent (review mr72-73 M1) | Docs corrected (tests now check the wording), rotation runbook, PDA design for mainnet |
| Test-count breakdowns that did not add up to their headline totals | Reviewer agent | Counts re-derived from the mocha logs |
| Flaky timing tests (X-03, SIM-08) | Suite runs | Harness-only slack and clock-sysvar polling (MR !34) |
| D-026 first version: a worker restart after 08:00 ET raised a false "create deadline missed" ALERT even with every market on-chain (M1); an operator strike for today could not be set after 08:00 (M2) | Independent review subagent (phase 2) | ALERT decided after the on-chain scan and create pass; late `--date <today>` strikes accepted until 16:00 ET with a warning (commit `a77325e`, !93) |
| Shell scripts checked out with CRLF line endings on Windows broke in Linux containers | Running the Docker toolchain | `.gitattributes` forces LF (!94) |
| The CI pin, Solana 2.1.0, cannot build the edition-2024 crates now in `Cargo.lock` | Docker toolchain build | Toolchain moved to Agave 4.3.0 (`docker/toolchain.Dockerfile`); `.gitlab-ci.yml` pin is still stale |
| The Agave 4.x validator needs io_uring (blocked by Docker's default seccomp) and refuses to bind 0.0.0.0 | Starting the local instance | `seccomp:unconfined` on the local container only; RPC / WebSocket relayed with socat (`docker/compose.localnet.yml`, `docker/localnet/start.sh`) |
| 7 Anchor tests timed out with the test ledger on the Windows bind mount | Docker test run | Ledger on a Linux volume: 87 passing / 0 failing; `startup_wait` raised |
| The public devnet RPC rate-limited (429) the program deploy, leaving a half-written buffer | Devnet deploy, 2026-10-08 | Buffer closed and refunded; deploy and both Railway services moved to a dedicated devnet RPC |
| A new React hook (`useSolBalance`) was first placed after an early return in the Portfolio page, which breaks the rules of hooks | `next lint` in the local gate (DLV-125, 2026-10-08) | Hook moved above the early return before merge (!97) |

## 6. Where to look

| Need | Doc |
| --- | --- |
| Every slice, in order, with timestamps | [`internal/AI_LOG.md`](internal/AI_LOG.md) |
| Locked decisions | [`DECISIONS.md`](DECISIONS.md) |
| Work items and status | [`internal/TRACKER.md`](internal/TRACKER.md) |
| Agent operating rules | [`internal/CLAUDE.md`](internal/CLAUDE.md) |
