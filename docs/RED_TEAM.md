# Meridian red team checklist (Reviewers)

Abuse **cases** and review prompts — **no exploit steps, payloads, or reproduction procedures**.  
Audience: Meridian Reviewers before demo / deploy ladder advance.

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
- [ ] Prod decoder rejects Meridian **mock** price magic; only real Pyth Price layout.
- [ ] `admin_settle` respects delay; cannot silently rewrite a settled market.

## Phoenix / trading

- [ ] Meridian does not implement a matching engine or custodial order desk.
- [ ] Book wiring remains Yes base / USDC quote; UI No mapping cannot mint unpaired supply.
- [ ] Seat/ATA mistakes fail closed (no vault inconsistency).

## Ops / Railway

- [ ] Deployer and authority keys only in secret stores — never in git.
- [ ] Railway services cannot toggle `localnet-test` against public clusters.
- [ ] CI `assert-prod-no-fixtures` green on the exact artifact to deploy.

## Demo hygiene

- [ ] Demo script uses localnet/sim or clearly labeled staging — no accidental mainnet funds.
- [ ] No regulatory/compliance claims in UI copy or docs.

If a finding is **In Progress**, file an MR or TRACKER line — do not use “Blocked” wording.
