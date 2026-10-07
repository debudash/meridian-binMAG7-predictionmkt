# Meridian V1 evals

How we judge **V1 pass**. Ties to [`SPEC.md`](SPEC.md) §3 and [`TEST_MATRIX.md`](TEST_MATRIX.md).

## Pass bar (all required)

| Gate | Evidence |
| --- | --- |
| SPEC acceptance §3 | Checklist signed off by Debu after freeze lock |
| TDD core (D-016) | Failing-then-green for vault $1, mint, settle, redeem, pause |
| TEST_MATRIX **P0** | All P0 case IDs passing on main localnet |
| TEST_MATRIX **P1** (fees + invited edges) | M-03/R-05/V-06 + listed edges green |
| TEST_MATRIX **SIM** (D-017) | SIM-01…09 green under `localnet-test` only |
| Prod fixture hygiene | `yarn build:prod` + assert: no `sim_*` / mock / drain strings in `.so` / prod IDL |
| Forge | All MRs on Gauntlet GitLab via `glab` |

## Priority legend

| Priority | Role in V1 eval |
| --- | --- |
| **P0** | Must-gate platinum demo |
| **P1** | Important; fees + high-value edges |
| **P2** | Nice-to-have; may trail freeze |
| **SIM** | Hard acceptance for anytime demo (D-017); never in prod builds |

## Not used as V1 pass criteria

- Latency/fill SLOs ([`METRICS.md`](METRICS.md) aspirational).
- Mainnet volume or real-money soak (unless Debu adds later).
- UI polish beyond five-page IA in `docs/ui/`.
- Regulatory certifications (explicit non-goal).

## Reporting

**DLV-039 artifact:** [`TEST_RESULTS.md`](TEST_RESULTS.md) — pass counts + tip SHAs for Peak6 PRD handoff.

After suite runs on main tip: refresh that file with pass counts + commit SHA. Prefer `anchor test -- --features localnet-test` output + `yarn build:prod` assert log.
