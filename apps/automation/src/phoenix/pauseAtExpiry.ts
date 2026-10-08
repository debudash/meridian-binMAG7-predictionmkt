/**
 * Pause each Meridian strike's Phoenix book at expiry (review dd46769, option 1).
 *
 * At `expiry_ts - leadSecs` the pauser (the per-book seat-manager authority after the handoff, see
 * seatManager.ts) sends PSM ChangeMarketStatus(Paused). Paused = no new orders and no crosses;
 * cancels and withdrawals still work, so makers and traders can always pull their funds. Books
 * already Paused/Closed are left alone. A book whose seat-manager authority isn't the pauser (handoff
 * missing) is skipped with an alert; so is any due book that fails to pause, and any pause that
 * lands later than `alertAfterSecs` past expiry (missed-pause monitoring).
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  decodePhoenixMarketStatus,
  decodeSeatManager,
  PhoenixMarketStatus,
  psmChangeMarketStatusIx,
  seatManagerAddress,
} from "./seatManager";

export interface BookAtExpiry {
  strikeMarket: PublicKey;
  phoenixMarket: PublicKey;
  expiryTs: number;
  label?: string;
}

export interface BookState {
  /** null = Phoenix market account missing */
  status: PhoenixMarketStatus | null;
  /** null = seat manager account missing (book not under PSM) */
  seatManagerAuthority: PublicKey | null;
}

export type PauseAction =
  | "pause"
  | "wait"
  | "done"
  | "skip-not-authority"
  | "skip-missing"
  | "skip-uninitialized";

export interface PauseDecision {
  book: BookAtExpiry;
  action: PauseAction;
  /** Missed-pause monitoring: due book we can't pause, or a pause landing late */
  alert?: boolean;
}

export interface PauseTiming {
  /** Pause this many seconds before expiry (0 = at expiry). */
  leadSecs?: number;
  /** Alert when a due book is still not paused this many seconds after expiry. */
  alertAfterSecs?: number;
}

const DONE = new Set([PhoenixMarketStatus.Paused, PhoenixMarketStatus.Closed, PhoenixMarketStatus.Tombstoned]);

export function planPauses(
  books: readonly BookAtExpiry[],
  states: ReadonlyMap<string, BookState>,
  pauser: PublicKey,
  nowUnix: number,
  timing: PauseTiming,
): PauseDecision[] {
  const lead = timing.leadSecs ?? 0;
  const alertAfter = timing.alertAfterSecs ?? 120;
  return books.map((book) => {
    const s = states.get(book.phoenixMarket.toBase58());
    if (!s || s.status === null) return { book, action: "skip-missing" };
    if (DONE.has(s.status)) return { book, action: "done" };
    if (s.status === PhoenixMarketStatus.Uninitialized) return { book, action: "skip-uninitialized" };
    if (nowUnix < book.expiryTs - lead) return { book, action: "wait" };
    const overdue = nowUnix - book.expiryTs >= alertAfter;
    if (!s.seatManagerAuthority || !s.seatManagerAuthority.equals(pauser)) {
      return { book, action: "skip-not-authority", alert: true };
    }
    return overdue ? { book, action: "pause", alert: true } : { book, action: "pause" };
  });
}

/** ms until the earliest not-yet-paused book is due (0 if already due); null if none pending. */
export function nextPauseDelayMs(
  books: readonly BookAtExpiry[],
  states: ReadonlyMap<string, BookState>,
  nowMs: number,
  timing: PauseTiming,
): number | null {
  const lead = timing.leadSecs ?? 0;
  let best: number | null = null;
  for (const b of books) {
    const s = states.get(b.phoenixMarket.toBase58());
    if (!s || s.status === null || DONE.has(s.status) || s.status === PhoenixMarketStatus.Uninitialized) continue;
    const due = Math.max(0, (b.expiryTs - lead) * 1000 - nowMs);
    if (best === null || due < best) best = due;
  }
  return best;
}

export interface PauseDeps {
  listBooks(): Promise<BookAtExpiry[]>;
  readStates(books: readonly BookAtExpiry[]): Promise<Map<string, BookState>>;
  sendPause(book: BookAtExpiry): Promise<string>;
  nowUnix(): number;
  log(msg: string, extra?: unknown): void;
  alert(msg: string): void;
}

export interface PausePassResult {
  paused: Array<{ book: BookAtExpiry; signature: string }>;
  failed: Array<{ book: BookAtExpiry; error: string }>;
  decisions: PauseDecision[];
  /** Exact-time follow-up for the next book still pending, or null */
  nextDelayMs: number | null;
}

const name = (b: BookAtExpiry) => b.label ?? b.phoenixMarket.toBase58();

export async function runPausePass(deps: PauseDeps, pauser: PublicKey, timing: PauseTiming): Promise<PausePassResult> {
  const books = await deps.listBooks();
  const states = books.length ? await deps.readStates(books) : new Map<string, BookState>();
  const now = deps.nowUnix();
  const decisions = planPauses(books, states, pauser, now, timing);
  const out: PausePassResult = { paused: [], failed: [], decisions, nextDelayMs: null };
  for (const d of decisions) {
    const b = d.book;
    if (d.action === "skip-not-authority") {
      deps.alert(
        `book ${name(b)} (phoenix ${b.phoenixMarket.toBase58()}) is past expiry and still trading, but the pauser ` +
          `${pauser.toBase58()} is not its seat-manager authority (${states.get(b.phoenixMarket.toBase58())?.seatManagerAuthority?.toBase58() ?? "none"}) — run the handoff`,
      );
      continue;
    }
    if (d.action !== "pause") continue;
    try {
      const signature = await deps.sendPause(b);
      out.paused.push({ book: b, signature });
      // Pausing is the expected outcome now, not an incident: mark it Paused for the follow-up timer.
      states.set(b.phoenixMarket.toBase58(), { ...states.get(b.phoenixMarket.toBase58())!, status: PhoenixMarketStatus.Paused });
      deps.log(`paused book at expiry`, { book: name(b), phoenix: b.phoenixMarket.toBase58(), strike: b.strikeMarket.toBase58(), expiryTs: b.expiryTs, lateSecs: now - b.expiryTs, sig: signature });
      if (d.alert) deps.alert(`book ${name(b)} paused ${now - b.expiryTs}s after expiry (late)`);
    } catch (e) {
      const error = String(e instanceof Error ? e.message : e).slice(0, 300);
      out.failed.push({ book: b, error });
      deps.alert(`pause FAILED for book ${name(b)} (phoenix ${b.phoenixMarket.toBase58()}, ${now - b.expiryTs}s past expiry): ${error}`);
    }
  }
  // Exact-time follow-up only for books not yet due; failed / not-authority books retry on the next tick
  // (no tight loop against a broken RPC or a missing handoff).
  const waiting = decisions.filter((d) => d.action === "wait").map((d) => d.book);
  out.nextDelayMs = nextPauseDelayMs(waiting, states, now * 1000, timing);
  return out;
}

/** Strike markets with a Phoenix book (any Meridian status: a settled market's book still trades). */
export async function listBooksFromChain(program: Program): Promise<BookAtExpiry[]> {
  const all = await (program.account as any).strikeMarket.all();
  const out: BookAtExpiry[] = [];
  for (const m of all) {
    const phoenix: PublicKey | undefined = m.account.phoenixMarket;
    if (!phoenix || phoenix.equals(PublicKey.default)) continue;
    const sym = Buffer.from(m.account.equitySymbol ?? []).toString("utf8").replace(/\0/g, "").trim();
    const strike = Number(m.account.strikePriceE6?.toString?.() ?? 0) / 1e6;
    out.push({
      strikeMarket: m.publicKey,
      phoenixMarket: phoenix,
      expiryTs: Number(m.account.expiryTs.toString()),
      label: `${sym || "?"}>=${strike}`,
    });
  }
  return out;
}

/** Header + seat-manager reads with dataSlice: ~16 / 96 bytes per book instead of the 232 KB market. */
export async function readBookStates(connection: Connection, books: readonly BookAtExpiry[]): Promise<Map<string, BookState>> {
  const out = new Map<string, BookState>();
  for (let i = 0; i < books.length; i += 100) {
    const part = books.slice(i, i + 100);
    const hdrs = await connection.getMultipleAccountsInfo(part.map((b) => b.phoenixMarket), { commitment: "confirmed", dataSlice: { offset: 0, length: 16 } });
    const sms = await connection.getMultipleAccountsInfo(part.map((b) => seatManagerAddress(b.phoenixMarket)), { commitment: "confirmed", dataSlice: { offset: 0, length: 96 } });
    part.forEach((b, j) => {
      const h = hdrs[j];
      const s = sms[j];
      out.set(b.phoenixMarket.toBase58(), {
        status: h ? decodePhoenixMarketStatus(h.data) : null,
        seatManagerAuthority: s && s.data.length >= 96 ? decodeSeatManager(s.data).authority : null,
      });
    });
  }
  return out;
}

export function livePauseDeps(opts: {
  connection: Connection;
  program: Program;
  pauser: Keypair;
  /** Books already confirmed Paused/Closed: skipped from the per-tick reads */
  doneBooks?: Set<string>;
  log?: (msg: string, extra?: unknown) => void;
  alert?: (msg: string) => void;
}): PauseDeps {
  const log = opts.log ?? ((msg, extra) => console.log(`[pause] ${extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`}`));
  const alert = opts.alert ?? ((msg) => console.error(`[pause] ALERT ${msg}`));
  const done = opts.doneBooks;
  return {
    listBooks: async () => (await listBooksFromChain(opts.program)).filter((b) => !done?.has(b.phoenixMarket.toBase58())),
    readStates: async (books) => {
      const m = await readBookStates(opts.connection, books);
      if (done) for (const [k, s] of m) if (s.status !== null && DONE.has(s.status)) done.add(k);
      return m;
    },
    sendPause: async (book) => {
      const tx = new Transaction().add(psmChangeMarketStatusIx({ market: book.phoenixMarket, authority: opts.pauser.publicKey, status: PhoenixMarketStatus.Paused }));
      const sig = await sendAndConfirmTransaction(opts.connection, tx, [opts.pauser], { commitment: "confirmed" });
      done?.add(book.phoenixMarket.toBase58());
      return sig;
    },
    nowUnix: () => Math.floor(Date.now() / 1000),
    log,
    alert,
  };
}

/** Worker: exact-time follow-up pass only when the next book is due before the next tick. */
export function followUpDelayMs(nextDelayMs: number | null, tickMs: number): number | null {
  if (nextDelayMs === null || nextDelayMs >= tickMs) return null;
  return nextDelayMs + 500;
}
