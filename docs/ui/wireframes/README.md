# Meridian UI wireframes (SPEC freeze)

**Status:** Slot for Meridian UI assets on SPEC freeze MR **!20** (`docs/d012-spec-freeze`).  
**Rule (Debu):** Wireframes land **in this MR**, not a separate merge request.  
**SPEC pointer:** [`../SPEC.md`](../SPEC.md) §3.10 · §8.

## Required coverage (V1)

| Surface | Spec | Expected artifact (name suggestion) |
| --- | --- | --- |
| Landing | [`../01-landing.md`](../01-landing.md) | `landing.png` (or `.svg`) |
| Markets | [`../02-markets.md`](../02-markets.md) | `markets.png` |
| Trade | [`../03-trade.md`](../03-trade.md) | `trade-yes.png`, `trade-no.png` (or one multi-state) |
| Portfolio | [`../04-portfolio.md`](../04-portfolio.md) | `portfolio.png` |
| History | [`../05-history.md`](../05-history.md) | `history.png` |

## Normative rules the wireframes must show

Align with [`../06-trading-intents-and-constraints.md`](../06-trading-intents-and-constraints.md):

1. **One book** — Yes/No are perspectives, not two markets.
2. **Four intents** — Buy Yes / Sell Yes / Buy No / Sell No.
3. **No simultaneous Yes+No** from the Trade UI.
4. Settlement **countdown** visible on market surfaces.
5. Payoff copy: winning side **$1 USDC**; losing **$0** — no regulatory claims.

## How to push (Meridian UI)

```bash
GITLAB_HOST=labs.gauntletai.com
git fetch origin docs/d012-spec-freeze
git checkout docs/d012-spec-freeze
# add PNG/SVG under docs/ui/wireframes/
# update this README table with real filenames + one-line captions
git add docs/ui/wireframes
git commit -m "ui: add V1 wireframes for SPEC freeze (!20)"
git push origin docs/d012-spec-freeze
```

## Index (fill as assets land)

| File | Caption | Spec |
| --- | --- | --- |
| _pending_ | UI to add | — |

When all five surfaces have at least one checked-in wireframe, mark TRACKER wireframe item Done and ping Meridian PM / Grok Bot for SPEC lock.
