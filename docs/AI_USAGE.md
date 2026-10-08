# AI usage log

How AI was used to build Meridian, who decided what, and how AI output was checked. The full chronological record (every slice, MR and decision with timestamps) is [`internal/AI_LOG.md`](internal/AI_LOG.md); this page summarises it.

## 1. Tools and roles

| Period | Tool | Role |
| --- | --- | --- |
| 2026-10-06 onward | **Grok Bot** (orchestrator agent) | Chief of staff: split work into slices, briefed specialist agents, enforced the land path and locks, owned completeness and security (D-008) |
| 2026-10-06 onward | Specialist agents spawned by Grok Bot (D-009) | **PM** (SPEC, acceptance, tracker) · **Schema** (accounts, instructions, units, flows) · **UI** (page specs, wireframes) · **Engineers** (Anchor program, Next.js app, Node automation, ops scripts) · **Testers** (test matrix, failing suites first, test plans) · **Reviewers** (security and architecture reviews, demo readiness) |
| 2026-10-08 onward | **Claude Code** (Anthropic) | Coding and docs agent working in git worktrees under the same rules (this deliverables refactor is one of its tasks) |
| Throughout | **Debu Dash** (human owner) | Product and risk decisions, locks, approvals, merges, hands-on testing |

All work landed through merge requests on the project's GitLab (D-001, D-014).

## 2. Working model

1. **Spec first.** PM / Schema / UI agents wrote SPEC, SCHEMA and UI specs; Debu locked SPEC on 2026-10-06 (MR !20).
2. **Failing tests first.** Testers wrote red suites before any implementation for vault $1, mint, settle, redeem and pause (D-016, Debu's mandate). Example: the P0 suite (MR !6, 37 cases) went red → green in the Engineers' MR !9.
3. **One slice per MR.** Engineers implemented only to green; each MR states branch, tests run and results.
4. **AI review.** Reviewer agents reviewed security-sensitive and deploy-ladder MRs and wrote findings by severity (High / Medium / Low). Fixes came back as follow-up MRs with their own tests.
5. **Human decision.** Debu (or Grok Bot on an explicit instruction from Debu) decided scope, accepted or declined review findings, and merged.
6. **Record.** Each slice appended an entry to `AI_LOG.md` and moved its tracker card; durable decisions became rows in [`DECISIONS.md`](DECISIONS.md).

## 3. What the human decided vs what agents did

| Debu decided | Agents did |
| --- | --- |
| Stack and forge: Solana + Anchor, Phoenix (integrate, do not build), Pyth, USDC; GitLab only (D-001, D-002) | Wrote the program, web app, automation and ops scripts |
| TDD mandate (D-016) and anytime-sim as hard acceptance (D-017) | Wrote the test matrix and the red suites, then the code to green them |
| Locked SPEC and approved the wireframes (MR !20) | Drafted SPEC, schema and UI specs and wireframes |
| Phoenix V1 spot as a working assumption, no extra confirmation step (D-015) | Wired one Yes/USDC book per strike and mapped four intents onto it |
| Product simplifications: hide post-only (D-021); "anything selected must be clearly highlighted" (D-022) | Implemented and tested them |
| Declined a git-history rewrite after the committed-keypair finding | Rotated the program id and removed the key from the tree |
| Approved operator-sourced prices with a logged source while the Hermes key lacks equities; one market creator (worker, not the box) | Built `ops/operator-prices.cjs`, the source-required checks and the creator switch |
| Flagged issues from hands-on use (e.g. could not place an order on localnet; markets expiring days later instead of today) | Root-caused and fixed them with tests (DLV-066, DLV-118) |

## 4. How AI output was verified

- **TDD:** failing tests first on every core path; suites must stay green before merge.
- **Reviewer agents:** separate agents with a security brief reviewed MRs; findings tracked to closure (e.g. review "mr72-73" M1–M3, "!91" M-1 and L-1…L-9).
- **Local gates:** the labs GitLab host has no CI runners, so the gate was a local run of every suite, `tsc`, lint, `next build` and the prod fixture assert, with counts recorded in the MR and the log.
- **Real-system checks:** real Phoenix V1 and Seat Manager programs loaded into a local validator; prod `.so` tested in LiteSVM with real devnet and mainnet Pyth account bytes; a dry run of the prod build against cloned devnet accounts.
- **Hardening passes:** end-to-end, UI smoke and security sweeps on 2026-10-07 ([`TEST_RESULTS.md`](TEST_RESULTS.md)).
- **Human testing:** Debu clicked through the app on localnet; manual runbooks for localnet and devnet.

## 5. Notable AI mistakes caught and fixed

| Mistake | How it was caught | Fix |
| --- | --- | --- |
| Phoenix order size sent in atoms instead of whole tokens (10⁶× too large). A Reviewer agent had signed this off as correct | Placing real orders against Phoenix V1 on localnet after Debu could not trade | D-020 records the correction; `size.test.ts` rewritten (DLV-066) |
| Prod settle decoded the legacy Pyth push layout, which real equity feeds no longer use (`InvalidPythAccount`) | Dry run of the prod `.so` against cloned devnet accounts | Pull-oracle settle (D-025), 21 then 22 LiteSVM cases on the prod binary |
| A program keypair was committed to git | Reviewer agent report (High) | Key revoked, program id rotated, `keys/*` gitignored ([`keys/README.md`](../keys/README.md)) |
| A production build with localnet env served the dev-wallet secret key; spoofed `Host` headers also reached it | Hardening security sweep | Dev wallet impossible in production builds; loopback-only checks, including a self-probe of the server's own interfaces (DLV-080, DLV-081) |
| React hydration errors on every trade page load (inline `<style>` escaped by SSR) and on countdowns | Hardening UI smoke on a production build | CSS moved to `globals.css` with a guard test; server time passed to the clock provider (DLV-079, DLV-086) |
| Buy No could mint and then under-fill, leaving the user with Yes + No; a 0-fill showed "Submitted" | Hardening real-Phoenix E2E | Market orders made fill-or-kill (D-024) |
| Web silently showed sample (fixture) markets on any cluster when RPC failed | Devnet staging dry run | Fixtures only on localnet with a loopback RPC (DLV-084, DLV-092) |
| Daily markets expired days later, not at today's close, against SPEC | Debu, from the UI | Shared same-day market rule with DST, holidays and early closes (DLV-118, DLV-119) |
| Docs called the pauser key "low privilege"; it is a full Seat Manager authority | Reviewer agent (review mr72-73 M1) | Docs corrected (tests now check the wording), rotation runbook, PDA design for mainnet |
| Test-count breakdowns that did not add up to their headline totals | Reviewer agent | Counts re-derived from the mocha logs |
| Flaky timing tests (X-03, SIM-08) | Suite runs | Harness-only slack and clock-sysvar polling (MR !34) |

## 6. Where to look

| Need | Doc |
| --- | --- |
| Every slice, in order, with timestamps | [`internal/AI_LOG.md`](internal/AI_LOG.md) |
| Locked decisions | [`DECISIONS.md`](DECISIONS.md) |
| Work items and status | [`internal/TRACKER.md`](internal/TRACKER.md) |
| Agent operating rules | [`internal/CLAUDE.md`](internal/CLAUDE.md) |
