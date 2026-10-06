# Meridian decisions index

Short index of durable product/tech decisions. Narrative detail lives in [`AI_LOG.md`](AI_LOG.md).

| ID | Topic | Decision | Owner | Date |
| --- | --- | --- | --- | --- |
| D-001 | SCM | Source of truth = Gauntlet Labs GitLab `debudash/peak6-meridian` | Debu / Grok Bot | 2026-10-06 |
| D-002 | Stack | Solana + Anchor; Phoenix CLOB (integrate); Pyth equity closes | Grok Bot stack lock | 2026-10-06 |
| D-003 | Units | `PRICE_SCALE = 1e6` for strike / settlement / Yes price | Meridian Schema | 2026-10-06 |
| D-004 | Phoenix wiring | Base = Yes mint; quote = USDC | Meridian Schema | 2026-10-06 |
| D-005 | Settle gates | Max staleness 150 slots; max conf ratio 500 bps; Yes if settle ≥ strike | Meridian Schema | 2026-10-06 |
| D-006 | Payout | $1 USDC binary; vault covers pairs minted | Meridian Schema | 2026-10-06 |
