/**
 * Pause each Meridian strike's Phoenix book at expiry (review dd46769, option 1).
 *
 * At `expiry_ts - leadSecs` the pauser (the per-book seat-manager authority after the handoff, see
 * seatManager.ts) sends PSM ChangeMarketStatus(Paused). Paused = no new orders and no crosses;
 * cancels and withdrawals still work, so makers and traders can always pull their funds. Books
 * already Paused/Closed are left alone. A book whose seat-manager authority isn't the pauser (handoff
 * missing) is skipped with an alert; so is any due book that fails to pause, and any pause that
 * lands later than `alertAfterSecs` past expiry (missed-pause monitoring).
 *
 * Reviewers mr72-73 M2: paused books are NOT dropped from monitoring. Every pass re-reads every book
 * (240-byte header slice incl. the Phoenix market authority + 96-byte seat manager), so a book that
 * goes Active again after expiry is re-paused with "[pause] ALERT … went Active again", and a Phoenix
 * market authority ≠ Seat Manager PDA or an SM authority ≠ pauser raises "[pause] ALERT" (rate-limited
 * to once per book per hour, immediately again if the observed value changes). L2: one undecodable
 * book is a per-book alert, and an RPC failure during a pass alerts with the due books instead of
 * escaping as a generic worker error.
 *
 * Reviewers !78 follow-up:
 *  N-2  a book that left PSM (market authority ≠ SM PDA) gets no pause send (`skip-left-psm`: PSM can't pause it, the
 *       send only fails), and "went Active again" / "pause FAILED" go through the keyed rate limit
 *       (PHOENIX_PAUSE_ALERT_REPEAT_SECS, default 1 h) instead of alerting every tick.
 *  N-3  any listed book whose SM authority isn't the pauser alerts (rate-limited) whatever the memory / due time, and
 *       the memory can be persisted across restarts (pauseMemoryStore.ts).
 *  N-4  a failed pass with no successful listing yet (first pass after start) or 3 failures in a row alerts.
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  decodePhoenixMarketHeader,
  decodeSeatManager,
  PHOENIX_HEADER_SLICE,
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
  /** Phoenix MarketHeader.authority (should be the Seat Manager PDA); undefined = not read */
  marketAuthority?: PublicKey | null;
  /** L2: the book's accounts were fetched but couldn't be decoded */
  error?: string;
}

export type PauseAction =
  | "pause"
  | "wait"
  | "done"
  | "skip-not-authority"
  | "skip-left-psm"
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
  /** N-2: repeat interval for a standing (unchanged) alert per book / reason (default ALERT_REPEAT_SECS). */
  alertRepeatSecs?: number;
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
    if (s?.error) return { book, action: "skip-missing", alert: nowUnix >= book.expiryTs - lead };
    if (!s || s.status === null) return { book, action: "skip-missing" };
    if (DONE.has(s.status)) return { book, action: "done" };
    if (s.status === PhoenixMarketStatus.Uninitialized) return { book, action: "skip-uninitialized" };
    // N-2: the book left PSM (PSM 9 → Phoenix 101): PSM ChangeMarketStatus can only fail, so never send it.
    if (s.marketAuthority !== undefined && !(s.marketAuthority && s.marketAuthority.equals(seatManagerAddress(book.phoenixMarket)))) {
      return { book, action: "skip-left-psm", alert: nowUnix >= book.expiryTs - lead };
    }
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

/** Cross-pass memory (M2 re-pause detection, authority-change detection, alert rate limiting, L2 due books). */
export interface PauseMemory {
  /** Books seen Paused/Closed (or paused by us) at least once */
  pausedOnce: Set<string>;
  /** Books seen with the pauser as SM authority */
  onPauser: Set<string>;
  /** alert key → last unix time sent */
  lastAlert: Map<string, number>;
  /** Last successful listing (L2: name the due books when a later pass fails) */
  lastBooks: BookAtExpiry[];
  /** N-4: passes failed in a row (reset by a good pass) */
  consecutiveFailures: number;
}

export function createPauseMemory(): PauseMemory {
  return { pausedOnce: new Set(), onPauser: new Set(), lastAlert: new Map(), lastBooks: [], consecutiveFailures: 0 };
}

/** N-4: alert on this many failed passes in a row even when no known book is due. */
export const PASS_FAILURE_ALERT_AFTER = 3;

/** Repeat interval for standing (non-changing) authority / handoff alerts. */
export const ALERT_REPEAT_SECS = 3600;

export interface PausePassResult {
  paused: Array<{ book: BookAtExpiry; signature: string }>;
  failed: Array<{ book: BookAtExpiry; error: string }>;
  decisions: PauseDecision[];
  /** Exact-time follow-up for the next book still pending, or null */
  nextDelayMs: number | null;
  /** L2: the pass couldn't list/read books (alerted when any known book was due) */
  passError?: string;
}

const name = (b: BookAtExpiry) => b.label ?? b.phoenixMarket.toBase58();

export async function runPausePass(
  deps: PauseDeps,
  pauser: PublicKey,
  timing: PauseTiming,
  memory: PauseMemory = createPauseMemory(),
): Promise<PausePassResult> {
  const lead = timing.leadSecs ?? 0;
  const repeat = timing.alertRepeatSecs ?? ALERT_REPEAT_SECS;
  const alertKeyed = (key: string, msg: string, now: number) => {
    const last = memory.lastAlert.get(key);
    if (last !== undefined && now - last < repeat) return;
    memory.lastAlert.set(key, now);
    deps.alert(msg);
  };

  let books: BookAtExpiry[];
  let states: Map<string, BookState>;
  try {
    books = await deps.listBooks();
    states = books.length ? await deps.readStates(books) : new Map<string, BookState>();
  } catch (e) {
    // L2: never let an RPC failure skip the ALERT channel while books are due.
    const now = deps.nowUnix();
    const err = String(e instanceof Error ? e.message : e).slice(0, 300);
    memory.consecutiveFailures = (memory.consecutiveFailures ?? 0) + 1;
    const n = memory.consecutiveFailures;
    const due = memory.lastBooks.filter((b) => now >= b.expiryTs - lead);
    if (due.length) deps.alert(`pause pass FAILED while ${due.length} book(s) due (${due.map(name).join(", ")}): ${err}`);
    // N-4: the first pass after start has no listing to name due books from — alert anyway.
    else if (memory.lastBooks.length === 0) deps.alert(`pause pass FAILED with no successful listing yet (${n} in a row; books can't be checked): ${err}`);
    else if (n >= PASS_FAILURE_ALERT_AFTER) alertKeyed("passfail", `pause pass FAILED ${n} consecutive times (no book due yet): ${err}`, now);
    return { paused: [], failed: [], decisions: [], nextDelayMs: null, passError: err };
  }
  memory.consecutiveFailures = 0;
  memory.lastBooks = books;
  const now = deps.nowUnix();
  const decisions = planPauses(books, states, pauser, now, timing);
  const out: PausePassResult = { paused: [], failed: [], decisions, nextDelayMs: null };
  for (const d of decisions) {
    const b = d.book;
    const key = b.phoenixMarket.toBase58();
    const s = states.get(key);
    if (s?.status != null && DONE.has(s.status)) memory.pausedOnce.add(key);

    // M2: authority monitoring on every book, every pass (paused books included).
    if (s && !s.error) {
      const pda = seatManagerAddress(b.phoenixMarket);
      if (s.marketAuthority && !s.marketAuthority.equals(pda)) {
        alertKeyed(`mkt:${key}:${s.marketAuthority.toBase58()}`,
          `book ${name(b)} (phoenix ${key}) Phoenix market authority ${s.marketAuthority.toBase58()} is not the Seat Manager PDA ${pda.toBase58()} — PSM can no longer pause it`, now);
      }
      if (s.seatManagerAuthority?.equals(pauser)) memory.onPauser.add(key);
      else if (memory.onPauser.has(key) && d.action !== "skip-not-authority") {
        alertKeyed(`sm:${key}:${s.seatManagerAuthority?.toBase58() ?? "none"}`,
          `book ${name(b)} (phoenix ${key}) seat-manager authority changed from the pauser ${pauser.toBase58()} to ${s.seatManagerAuthority?.toBase58() ?? "none"} — it CHANGED away from the pauser`, now);
      } else if (s.seatManagerAuthority && d.action !== "skip-not-authority") {
        // N-3: alert for every listed book, not only due ones or ones this process saw on the pauser.
        alertKeyed(`sm:${key}:${s.seatManagerAuthority.toBase58()}`,
          `book ${name(b)} (phoenix ${key}) seat-manager authority ${s.seatManagerAuthority.toBase58()} is not the pauser ${pauser.toBase58()} — run the handoff (or it changed before this watcher started)`, now);
      }
    }

    if (d.action === "skip-left-psm") {
      // N-2: the mkt: alert above names it; an unpause by the new raw authority is one keyed alert, no send.
      if (s?.status === PhoenixMarketStatus.Active && memory.pausedOnce.has(key)) {
        alertKeyed(`reopen:${key}`, `book ${name(b)} (phoenix ${key}) went Active again after it was paused, but it left the Seat Manager — ops can't re-pause it; tell users to cancel and withdraw`, now);
      }
      continue;
    }

    if (d.action === "skip-missing" && s?.error && d.alert) {
      alertKeyed(`err:${key}`, `book ${name(b)} (phoenix ${key}) is due but its state could not be read: ${s.error}`, now);
      continue;
    }
    if (d.action === "skip-not-authority") {
      const cur = s?.seatManagerAuthority?.toBase58() ?? "none";
      alertKeyed(`notauth:${key}:${cur}`,
        `book ${name(b)} (phoenix ${key}) is past expiry and still trading, but the pauser ` +
          `${pauser.toBase58()} is not its seat-manager authority (${cur})` +
          `${memory.onPauser.has(key) ? " — it CHANGED away from the pauser" : " — run the handoff"}`, now);
      continue;
    }
    if (d.action !== "pause") continue;
    const reopened = memory.pausedOnce.has(key);
    if (reopened) alertKeyed(`reopen:${key}`, `book ${name(b)} (phoenix ${key}) went Active again after it was paused (status ${PhoenixMarketStatus[s!.status!]}) — re-pausing`, now);
    try {
      const signature = await deps.sendPause(b);
      out.paused.push({ book: b, signature });
      memory.pausedOnce.add(key);
      // Pausing is the expected outcome now, not an incident: mark it Paused for the follow-up timer.
      states.set(key, { ...states.get(key)!, status: PhoenixMarketStatus.Paused });
      deps.log(reopened ? `re-paused book` : `paused book at expiry`, { book: name(b), phoenix: key, strike: b.strikeMarket.toBase58(), expiryTs: b.expiryTs, lateSecs: now - b.expiryTs, sig: signature });
      if (d.alert && !reopened) deps.alert(`book ${name(b)} paused ${now - b.expiryTs}s after expiry (late)`);
    } catch (e) {
      const error = String(e instanceof Error ? e.message : e).slice(0, 300);
      out.failed.push({ book: b, error });
      alertKeyed(`fail:${key}`, `pause FAILED for book ${name(b)} (phoenix ${key}, ${now - b.expiryTs}s past expiry): ${error}`, now);
    }
  }
  // Exact-time follow-up only for books not yet due; failed / not-authority books retry on the next tick
  // (no tight loop against a broken RPC or a missing handoff).
  const waiting = decisions.filter((d) => d.action === "wait").map((d) => d.book);
  out.nextDelayMs = nextPauseDelayMs(waiting, states, now * 1000, timing);
  return out;
}

/**
 * L3: serialize passes without losing a request. A call while a run is in flight sets a rerun flag;
 * the running pass loops once more when it finishes (never two concurrent passes, never a lost one).
 */
export function serialRunner(fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  let rerun = false;
  return async () => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await fn();
      } while (rerun);
    } finally {
      running = false;
    }
  };
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

/** Header + seat-manager reads with dataSlice: 240 / 96 bytes per book instead of the 232 KB market. */
export async function readBookStates(connection: Connection, books: readonly BookAtExpiry[]): Promise<Map<string, BookState>> {
  const out = new Map<string, BookState>();
  for (let i = 0; i < books.length; i += 100) {
    const part = books.slice(i, i + 100);
    const hdrs = await connection.getMultipleAccountsInfo(part.map((b) => b.phoenixMarket), { commitment: "confirmed", dataSlice: { offset: 0, length: PHOENIX_HEADER_SLICE } });
    const sms = await connection.getMultipleAccountsInfo(part.map((b) => seatManagerAddress(b.phoenixMarket)), { commitment: "confirmed", dataSlice: { offset: 0, length: 96 } });
    part.forEach((b, j) => {
      const h = hdrs[j];
      const s = sms[j];
      // L2: one bad account is a per-book error, never a failed pass for every book.
      try {
        const hdr = h ? decodePhoenixMarketHeader(h.data) : null;
        out.set(b.phoenixMarket.toBase58(), {
          status: hdr ? hdr.status : null,
          marketAuthority: hdr ? hdr.authority : null,
          seatManagerAuthority: s && s.data.length >= 96 ? decodeSeatManager(s.data).authority : null,
        });
      } catch (e) {
        out.set(b.phoenixMarket.toBase58(), { status: null, seatManagerAuthority: null, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
      }
    });
  }
  return out;
}

export function livePauseDeps(opts: {
  connection: Connection;
  program: Program;
  pauser: Keypair;
  log?: (msg: string, extra?: unknown) => void;
  alert?: (msg: string) => void;
}): PauseDeps {
  const log = opts.log ?? ((msg, extra) => console.log(`[pause] ${extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`}`));
  const alert = opts.alert ?? ((msg) => console.error(`[pause] ALERT ${msg}`));
  return {
    // M2: no permanent skip — paused books are re-read every pass (cheap dataSlice reads).
    listBooks: async () => listBooksFromChain(opts.program),
    readStates: async (books) => readBookStates(opts.connection, books),
    sendPause: async (book) => {
      const tx = new Transaction().add(psmChangeMarketStatusIx({ market: book.phoenixMarket, authority: opts.pauser.publicKey, status: PhoenixMarketStatus.Paused }));
      return sendAndConfirmTransaction(opts.connection, tx, [opts.pauser], { commitment: "confirmed" });
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
