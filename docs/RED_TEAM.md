# Meridian security review checklist (red team)

Abuse **cases** and review prompts — **no exploit steps, payloads, or reproduction procedures**.  
Audience: reviewers before a demo or a deploy-ladder step. Findings and their fixes are recorded in [`TEST_RESULTS.md`](TEST_RESULTS.md) §6 and [`PRD_TRACE.md`](PRD_TRACE.md).

## Custody & vault

- [ ] Admin / authority **cannot** drain user vault collateral in **production** builds.
- [ ] Any drain / mock / sim instructions exist **only** behind `localnet-test` and are absent from prod `.so` / prod IDL.
- [ ] Pause cannot strand settle/redeem incorrectly (pause policy per SCHEMA).
- [ ] Fee skim cannot exceed configured bps; prod fee caps / timelock honored.

## Sim & feature gates (D-017)

- [ ] Sim open/close / forced outcomes **cannot** compile or execute on devnet/mainnet artifacts.
- [ ] Prod settle still requires real time gate (≥4:00 PM ET policy) + Pyth quality — sim must not weaken these.
- [ ] Clients on staging/prod load **`idl/meridian.prod.json`**, not localnet IDL listing fixtures.

## Oracle & settlement

- [ ] Stale or wide-confidence Pyth prices are rejected; outcome immutable after successful settle.
- [ ] Prod `settle` accepts only a Pyth receiver-owned, Full-verified `PriceUpdateV2` with the market's feed id, the first update at or after expiry, within the window (D-025); the localnet mock layout is rejected.
- [ ] `admin_settle` respects delay; cannot silently rewrite a settled market.

## Phoenix / trading

- [ ] Meridian does not implement a matching engine or custodial order desk.
- [ ] Book wiring remains Yes base / USDC quote; UI No mapping cannot mint unpaired supply.
- [ ] Seat/ATA mistakes fail closed (no vault inconsistency).

## Ops / Railway

- [ ] Deployer and authority keys only in secret stores — never in git.
- [ ] Authority, settler and pauser keys are distinct; the upgrade key never reaches Railway.
- [ ] The pauser is a full Phoenix Seat Manager authority (can unpause, move authority): rotation and offline backup per [`runbooks/PAUSER_ROTATION.md`](runbooks/PAUSER_ROTATION.md); replaced by a program PDA before mainnet ([`design/phoenix-pause-pda-authority.md`](design/phoenix-pause-pda-authority.md)).
- [ ] Operator prices (`admin_settle`) always carry a logged source and are bound to one market and day.
- [ ] The Localnet Dev Wallet route is unreachable in production builds and on non-loopback servers.
- [ ] Railway services cannot toggle `localnet-test` against public clusters.
- [ ] CI `assert-prod-no-fixtures` green on the exact artifact to deploy.

## Demo hygiene

- [ ] Demo script uses localnet/sim or clearly labeled staging — no accidental mainnet funds.
- [ ] No regulatory/compliance claims in UI copy or docs.

Known history: a program keypair was once committed to git; it was revoked and the program id rotated (`GwTvo…` → `9Rb7nx…`, [`keys/README.md`](../keys/README.md)). Old git history still contains it. A second rotation is pending because the `9Rb7nx…` keypair was lost with the old build box (DLV-124).
