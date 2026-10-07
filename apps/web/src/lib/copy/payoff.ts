/** Canonical payoff copy — docs/ui/06 §4.1 */
export function oneLineExplainer(): string {
  return "Each contract pays 1.00 USDC if your side is right at settlement, and 0 if not.";
}

export function yesDefinition(
  symbol: string,
  strike: number,
  when: string,
): string {
  return `Yes pays 1.00 USDC if ${symbol} is at or above $${strike.toFixed(2)} at ${when} (Pyth).`;
}

export function noDefinition(
  symbol: string,
  strike: number,
  when: string,
): string {
  return `No pays 1.00 USDC if ${symbol} is below $${strike.toFixed(2)} at ${when} (Pyth).`;
}

export function buyPreview(q: number, pSide: number): string {
  const cost = q * pSide;
  const payout = q * 1;
  const maxProfit = q * (1 - pSide);
  return `Cost ${cost.toFixed(2)} USDC · Pays ${payout.toFixed(2)} USDC if right · Max profit ${maxProfit.toFixed(2)} USDC · Max loss ${cost.toFixed(2)} USDC`;
}

export function sellPreview(q: number, pSide: number): string {
  const proceeds = q * pSide;
  return `Receive ${proceeds.toFixed(2)} USDC now · You give up ${(q * 1).toFixed(2)} USDC payout if right`;
}

export function impliedLabel(price: number): string {
  const pct = Math.round(price * 100);
  // Never round 0.995 to 100%
  const safe = price >= 0.995 ? Math.min(pct, 99) : pct;
  return `${price.toFixed(2)} ≈ ${safe}% implied chance`;
}

export function shortQuestion(
  symbol: string,
  comparator: string,
  strike: number,
  whenShort: string,
): string {
  const cmp = comparator === ">=" ? "≥" : ">";
  return `${symbol} ${cmp} $${strike.toFixed(2)} at close ${whenShort}`;
}
