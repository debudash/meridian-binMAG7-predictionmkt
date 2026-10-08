# Agent operating notes (Meridian)

Short rules for any coding or docs agent working on this repo. Internal; not a deliverable.

## Read first

1. [`../SPEC.md`](../SPEC.md) (locked V1 contract) and [`../DECISIONS.md`](../DECISIONS.md) (locked decisions).
2. [`TRACKER.md`](TRACKER.md) (Done / In Progress / Todo).
3. [`../PRD_TRACE.md`](../PRD_TRACE.md) for where each Peak6 PRD line stands.

## Forge and landing work

- Source of truth: Gauntlet Labs GitLab `debudash/peak6-meridian` only (D-001). Never GitHub.
- Land with `glab` and `GITLAB_HOST=labs.gauntletai.com` (D-014): branch off `main` → commit → push → `glab mr create`.
- Reviewer agents review MRs; Debu (or an agent he authorizes) merges. Do not self-merge review-gated work.

## Product locks (do not contradict)

- Phoenix V1 spot, one Yes/USDC book per strike (D-004 / D-015). Meridian never matches orders.
- TDD is mandatory: failing tests first for vault $1, mint, settle, redeem, pause (D-016).
- Anytime sim (D-017) is hard acceptance; sim controls live only behind the `localnet-test` feature and must never weaken prod gates.
- Prod settle = Pyth pull oracle `PriceUpdateV2` (D-025).
- Railway hosts the web app and the automation worker ([`../DEPLOY.md`](../DEPLOY.md)). The program is deployed with the Solana CLI.
- No regulatory or compliance claims anywhere.
- Tracker columns: Todo / In Progress / Done only. No "Blocked" column.

## Docs etiquette

- Deliverable docs (everything in `docs/` outside `internal/`) stay current and free of process chatter.
- Edit existing SCHEMA / UI specs in place; do not rewrite them wholesale unless you own the slice.
- Append to [`AI_LOG.md`](AI_LOG.md) (America/Chicago timestamps, newest first). Never rewrite past entries.
- Add a DECISIONS row only for a new locked decision.

## Safety

- Never commit keypairs, tokens or secrets. Print only public keys.
- Never enable `localnet-test` on devnet or mainnet builds; `yarn build:prod` must pass `assert-prod-no-fixtures`.
- Red-team docs list cases and checklists only, never exploit steps.
