# Meridian demo script (localnet / anytime sim)

**Goal:** Walk create → mint → trade → settle → redeem in one sitting **without waiting** for real US equity 9:30 / 4:00 ET (D-017).  
**Cluster:** local validator + `anchor test` / scripted sim with `--features localnet-test`.  
**Do not** use this path on devnet/mainnet.

## Preconditions

1. Repo cloned; `yarn` / Anchor deps installed.
2. Build with localnet fixtures: `yarn build:localnet` (or equivalent).
3. Know program id from `Anchor.toml` / local deploy.
4. Wallet funded with fixture USDC on localnet.

## Scripted flow (preferred)

When the in-repo one-command sim lifecycle lands (TRACKER Todo), run that. Until then, use harness / Anchor tests:

```bash
# Full localnet suite includes SIM-01…09 lifecycle
yarn test
# or: anchor test -- --features localnet-test
```

## Manual walkthrough (conceptual)

| Step | Action | Expect |
| --- | --- | --- |
| 1 | Initialize Config (authority, collateral mint, settle gates 150 / 500 bps) | Config PDA live; paused=false |
| 2 | Create StrikeMarket (MAG7 symbol, strike e6, expiry, Phoenix pubkey, Pyth account) | status=Open; trading_open=true |
| 3 | **Sim open** (`sim_open_session`) if required by harness | Session armed for sim gates |
| 4 | **Mint** Yes/No for amount N (fee=0) | Vault += N; Yes supply == No supply == N |
| 5 | **Trade** | **On-book (preferred):** `simTradeOnBook` / Phoenix SDK place — Buy/Sell Yes; Buy No = mint+ask; Sell No market = bid+`merge_pair` ([`phoenix-onbook-sim.md`](phoenix-onbook-sim.md)). Off-book Yes SPL = **demoted non-prod fallback** only |
| 6 | **Sim close** (`sim_close_session`) | Mint blocked; settle allowed |
| 7 | **Settle** with mock/forced Pyth price → YesWins or NoWins | status SettledYes or SettledNo; immutable |
| 8 | **Redeem** winning mint amount | USDC out == amount (fee=0); vault decreases |
| 9 | Optional: pause mid-flow | Mint/create blocked; settle/redeem still OK |

## Talking points

- Non-custodial PDA vault; admin cannot drain in **prod** builds.
- $1 binary invariant after mint / trade / redeem.
- Phoenix is integrated CLOB (V1 spot assumption); Meridian does not match.
- Localnet on-book sim uses book-sim fills (+ real mint/merge); full Phoenix.so market create is residual — see [`phoenix-onbook-sim.md`](phoenix-onbook-sim.md).
- Sim is feature-gated; Railway/prod use real ≥4:00 PM ET + Pyth quality ([`DEPLOY.md`](DEPLOY.md)).

## Out of scope for this script

- Mainnet funds, KYC, regulatory claims.
- Waiting on real equity session hours.
