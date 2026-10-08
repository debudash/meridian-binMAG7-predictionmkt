/**
 * Market-card position badge (docs/ui/02-markets.md: "You: Yes 40" / "You: No 25").
 * Holding both sides (legacy E7/E8) shows both quantities, amber like "Both sides held".
 */
export interface PositionBadge {
  text: string;
  tone: "yes" | "no" | "both";
}

export function positionBadge({
  connected,
  yesQty,
  noQty,
  lotSize,
}: {
  connected: boolean;
  yesQty: number;
  noQty: number;
  lotSize?: number;
}): PositionBadge | null {
  if (!connected) return null;
  const lot = lotSize ?? 1;
  const yes = yesQty >= lot;
  const no = noQty >= lot;
  if (yes && no) return { text: `You: Yes ${yesQty} · No ${noQty}`, tone: "both" };
  if (yes) return { text: `You: Yes ${yesQty}`, tone: "yes" };
  if (no) return { text: `You: No ${noQty}`, tone: "no" };
  return null;
}
