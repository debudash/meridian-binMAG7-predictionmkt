/**
 * L11 (Reviewers, !63): disclose the auto-sweep (WithdrawFunds(all free) prepended to each new
 * order, DLV-087) in one short line on the ticket and in the success toast.
 */
export function sweepDisclosure(
  seat: { yesFree: number; usdcFree: number } | null | undefined,
  tense: "present" | "past" = "present",
): string | null {
  if (!seat) return null;
  const parts: string[] = [];
  if (seat.yesFree > 0) parts.push(`${Number(seat.yesFree.toFixed(6))} Yes`);
  if (seat.usdcFree > 0) parts.push(`${seat.usdcFree.toFixed(2)} USDC`);
  if (parts.length === 0) return null;
  return `Also ${tense === "past" ? "moved" : "moves"} ${parts.join(" / ")} from your Phoenix account to your wallet.`;
}
