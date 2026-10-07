# Agent operating notes (Meridian)

Short rules for any coding / docs agent on this repo.

## Forge & land

- **Only** https://labs.gauntletai.com/debudash/peak6-meridian
- Land with `GITLAB_HOST=labs.gauntletai.com glab` (D-014). Never GitHub/Origin.
- CloudAgent / MCP GitLab 404 ≠ blocker.

## Product locks (do not contradict)

- **D-015:** Phoenix V1 spot = working assumption (Yes/USDC book).
- **D-016:** TDD mandatory — failing tests first for vault $1, mint, settle, redeem, pause.
- **D-017:** Anytime open/close/settle sim is V1 **hard acceptance**; feature-gate `localnet-test`; never weaken prod invariants.
- Railway = staging/prod host for Next.js + Node automation ([`DEPLOY.md`](DEPLOY.md)).
- Do **not** invent regulatory or compliance claims.
- Tracker: **Todo / In Progress / Done** only — no “Blocked” language.

## Docs etiquette

- Prefer editing existing SCHEMA / UI specs; do not rewrite them wholesale unless Schema/UI owns the slice.
- Append AI_LOG (America/Chicago); add DECISIONS rows only for new **locked** decisions.
- SPEC freeze candidate → Debu lock ping before treating SPEC as immutable.

## Safety

- Never commit keypairs or secrets.
- Never enable `localnet-test` on devnet/mainnet builds.
- Red-team docs: cases/checklists only — no exploit steps.
