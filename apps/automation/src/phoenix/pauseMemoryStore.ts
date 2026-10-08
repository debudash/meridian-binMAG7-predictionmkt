/**
 * Reviewers !78 N-3: persist the pause watcher's memory (paused-once / on-pauser sets, alert rate-limit times, last
 * listing) so a restart neither forgets that a book was on the pauser ("CHANGED away from the pauser" stays accurate)
 * nor re-fires every standing alert at once. Public data only (pubkeys, unix times); written atomically (0600).
 * A missing file is a fresh memory; a corrupt one is a fresh memory plus a warning — never a crash.
 */
import * as fs from "fs";
import { PublicKey } from "@solana/web3.js";
import { writeFileAtomicSync } from "../util/atomicWrite";
import { createPauseMemory, type PauseMemory } from "./pauseAtExpiry";

const VERSION = 1;

/** Alert timestamps older than this are dropped on save (the file must not grow forever). */
export const ALERT_MEMORY_TTL_SECS = 7 * 86_400;

export function serializePauseMemory(m: PauseMemory, nowUnix = Math.floor(Date.now() / 1000)): string {
  return JSON.stringify({
    version: VERSION,
    pausedOnce: [...m.pausedOnce],
    onPauser: [...m.onPauser],
    lastAlert: Object.fromEntries([...m.lastAlert].filter(([, t]) => nowUnix - t < ALERT_MEMORY_TTL_SECS)),
    lastBooks: m.lastBooks.map((b) => ({ strikeMarket: b.strikeMarket.toBase58(), phoenixMarket: b.phoenixMarket.toBase58(), expiryTs: b.expiryTs, label: b.label })),
  });
}

export function savePauseMemory(file: string, m: PauseMemory, nowUnix?: number): void {
  writeFileAtomicSync(file, serializePauseMemory(m, nowUnix), 0o600);
}

export function loadPauseMemory(file: string): { memory: PauseMemory; warning?: string } {
  const memory = createPauseMemory();
  if (!fs.existsSync(file)) return { memory };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.version !== VERSION) throw new Error(`unknown version ${j.version}`);
    for (const k of j.pausedOnce ?? []) memory.pausedOnce.add(String(k));
    for (const k of j.onPauser ?? []) memory.onPauser.add(String(k));
    for (const [k, v] of Object.entries(j.lastAlert ?? {})) if (Number.isFinite(Number(v))) memory.lastAlert.set(k, Number(v));
    memory.lastBooks = (j.lastBooks ?? []).map((b: any) => ({
      strikeMarket: new PublicKey(b.strikeMarket),
      phoenixMarket: new PublicKey(b.phoenixMarket),
      expiryTs: Number(b.expiryTs),
      label: b.label,
    }));
    return { memory };
  } catch (e) {
    return { memory: createPauseMemory(), warning: `pause memory file ${file} could not be read (${String(e instanceof Error ? e.message : e).slice(0, 120)}) — starting with a fresh memory` };
  }
}
