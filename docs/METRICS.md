# Meridian metrics

What we may measure later. Marked **V1 required** vs **aspirational**.

| Metric | V1 required? | Notes |
| --- | --- | --- |
| Localnet suite pass count (P0/P1/SIM/MP/P2) | **Yes** | **74/74** on main post-!34 (`65c1ddf`); see [`TEST_RESULTS.md`](TEST_RESULTS.md) |
| Prod fixture assert (`build:prod`) | **Yes** | No localnet-only ix names in prod artifacts |
| Vault $1 invariant after mint/redeem (fee=0) | **Yes** | TEST_MATRIX I1–I3 |
| Settle success under Pyth quality gates | **Yes** (localnet + staging) | Stale/wide-conf rejects must remain testable |
| E2E sim lifecycle runtime (wall clock) | Aspirational | Target: continuous harness, no equity-hour wait |
| Phoenix place→fill latency | Aspirational | External venue; track when on-book E2E exists |
| Fill rate / spread on Yes/USDC book | Aspirational | Post-demo ops |
| Automation settle retry success | Aspirational until worker ships | Railway automation env |
| UI page LCP / wallet connect success | Aspirational | After Next.js impl |
| Mainnet TVL / volume | Aspirational | Not a V1 demo gate |

No regulatory, compliance, or “fairness” metrics — do not invent claims.
