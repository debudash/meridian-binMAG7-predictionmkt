/**
 * Reviewers mr72-73 staging gate: every book in the staging state (including Friday books created before
 * !73) must have the pauser as seat-manager authority. Pure planning + reporting; ops-cli does the I/O.
 */
import type { PublicKey } from "@solana/web3.js";
import type { BookAtExpiry, BookState } from "./pauseAtExpiry";

export type HandoffAction = "handoff" | "ok" | "skip-no-psm" | "skip-foreign";

export interface HandoffStep {
  book: BookAtExpiry;
  action: HandoffAction;
  authority: PublicKey | null;
}

export function planHandoff(
  books: readonly BookAtExpiry[],
  states: ReadonlyMap<string, BookState>,
  current: PublicKey,
  pauser: PublicKey,
): HandoffStep[] {
  if (current.equals(pauser)) throw new Error("handoff: pauser must differ from the current seat-manager authority");
  return books.map((book) => {
    const auth = states.get(book.phoenixMarket.toBase58())?.seatManagerAuthority ?? null;
    if (!auth) return { book, action: "skip-no-psm", authority: null };
    if (auth.equals(pauser)) return { book, action: "ok", authority: auth };
    if (auth.equals(current)) return { book, action: "handoff", authority: auth };
    return { book, action: "skip-foreign", authority: auth };
  });
}

export function authorityReport(
  books: readonly BookAtExpiry[],
  states: ReadonlyMap<string, BookState>,
  pauser: PublicKey,
): { ok: boolean; onPauser: number; mismatches: Array<{ book: BookAtExpiry; authority: PublicKey | null }> } {
  const mismatches: Array<{ book: BookAtExpiry; authority: PublicKey | null }> = [];
  let onPauser = 0;
  for (const book of books) {
    const auth = states.get(book.phoenixMarket.toBase58())?.seatManagerAuthority ?? null;
    if (auth && auth.equals(pauser)) onPauser++;
    else mismatches.push({ book, authority: auth });
  }
  return { ok: mismatches.length === 0, onPauser, mismatches };
}
