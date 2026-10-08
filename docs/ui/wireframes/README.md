# Meridian UI wireframes (SPEC freeze)

**Status:** V1 desktop wireframes on SPEC freeze MR **!20** (`docs/d012-spec-freeze`).  
**Rule (Debu):** Wireframes land **in this MR**, not a separate merge request.  
**SPEC pointer:** [`../SPEC.md`](../../SPEC.md) §3.10 · §8.  
**Normative specs:** `docs/ui/01`–`07` remain source of truth; images illustrate layout.

## Coverage (V1)

| Surface | Spec | Artifact | Annotation |
| --- | --- | --- | --- |
| Landing `/` | [`../01-landing.md`](../01-landing.md) | [landing.jpg](landing.jpg) | [landing.md](landing.md) |
| Markets `/markets` | [`../02-markets.md`](../02-markets.md) | [markets.jpg](markets.jpg) | [markets.md](markets.md) |
| Trade `/markets/[id]` | [`../03-trade.md`](../03-trade.md) | [trade.jpg](trade.jpg) (Yes perspective + constraint) | [trade.md](trade.md) |
| Portfolio `/portfolio` | [`../04-portfolio.md`](../04-portfolio.md) | [portfolio.jpg](portfolio.jpg) | [portfolio.md](portfolio.md) |
| History `/history` | [`../05-history.md`](../05-history.md) | [history.jpg](history.jpg) | [history.md](history.md) |

## Normative rules shown

Align with [`../06-trading-intents-and-constraints.md`](../06-trading-intents-and-constraints.md):

1. **One book** — Yes/No are perspectives, not two markets.
2. **Four intents** — Buy Yes / Sell Yes / Buy No / Sell No.
3. **No simultaneous Yes+No** from the Trade UI (Trade wireframe: Buy No disabled while holding Yes).
4. Settlement **countdown** on market surfaces.
5. Payoff copy: winning side **1.00 USDC**; losing **0**.

## Out of scope
- Optional V1 **sim UI affordance** (D-017) — harness required; UI control not shown.
- Mobile breakpoints — see screen specs; these are desktop ≥1280.

## Image drift vs specs (trust annotations + `docs/ui/*` over pixels)
- Chain: **Solana** (mocks may show wrong network badges).
- Nav: Logo · Markets · Portfolio · History · cluster · wallet (`07`).
- Side accents: Yes **teal**, No **violet**; red/green for P&L / settled results only.
