/**
 * Operator CLI for the staging box (ops/run-staging.sh) — same tested code paths as the worker.
 *
 *   node dist/ops-cli.js pause-status [--state <staging-state.json>] [--expect-pauser <pubkey>]
 *                                                                        read-only: book status + SM authority;
 *                                                                        --expect-pauser: ALERT + exit 2 if any book's
 *                                                                        SM authority isn't that pubkey, or (N-5) its
 *                                                                        Phoenix market authority isn't the SM PDA
 *   node dist/ops-cli.js pause-once   [--state <file>]                    pause every due book once
 *   node dist/ops-cli.js pause-watch  [--state <file>] [--max-hours 96]   pause each book at its expiry and keep
 *                                    [--memory <file>]                   monitoring (M2: re-pause + ALERT if a book goes
 *                                                                        Active again or an authority changes) until
 *                                                                        --max-hours; --exit-when-paused = old behaviour.
 *                                                                        N-3: alert memory persisted to --memory (default
 *                                                                        <state>-pause-memory.json with --state; or
 *                                                                        PAUSE_MEMORY_FILE; --memory none = off)
 *   node dist/ops-cli.js handoff      [--state <file>] [--phoenix <pk>]…  seat-manager authority → pauser (PSM 6 + 7)
 *   node dist/ops-cli.js pull-settle  --market <strikeMarket>             permissionless settle via Pyth pull oracle
 *   node dist/ops-cli.js admin-price  --market <strikeMarket>             read-only: admin_settle fallback price (M3) =
 *                                                                        Hermes price at expiry, else OPERATOR_PRICE_E6 +
 *                                                                        OPERATOR_PRICE_SOURCE + OPERATOR_PRICE_MARKET,
 *                                                                        else ADMIN_PRICE_REFUSED (exit 4). Never stale.
 *
 * Env (never printed): SOLANA_RPC_URL, PHOENIX_PAUSER_KEYPAIR (path or JSON array),
 *   SEAT_MANAGER_AUTHORITY_KEYPAIR (handoff only: the CURRENT seat-manager authority; box only, never Railway),
 *   SETTLER_KEYPAIR + PYTH_HERMES_API_KEY [+ PYTH_HERMES_URL] (pull-settle), MERIDIAN_IDL_PATH / MERIDIAN_PROGRAM_ID
 *   (chain listing / settle), PHOENIX_PAUSE_LEAD_SECS, PHOENIX_PAUSE_ALERT_SECS, DRY_RUN=1 (read-only, no tx),
 *   ADMIN_PRICE_MAX_SKEW_SECS (admin-price: max |publish_time − expiry|, default 60 = on-chain; ≤ 300 as a logged override),
 *   PHOENIX_PAUSE_ALERT_REPEAT_SECS (standing ALERT repeat per book / reason, default 3600),
 *   PAUSER_MUST_DIFFER_FROM (comma list of pubkeys the pauser must not equal — keeper / settler / upgrade key; L5).
 * A missing --state file means "no books yet" (fresh staging), not an error.
 * Without --state, books come from the chain (every StrikeMarket with a Phoenix book; needs the prod IDL).
 */
import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { assertPauserDistinct, loadConfig, loadKeypairFromEnv } from "./config";
import { createProgram } from "./solana/client";
import { configPda } from "./solana/pdas";
import { livePullSettleDeps, publishWindowSecs, settleWithPullOracle } from "./solana/pullSettle";
import {
  createPauseMemory,
  listBooksFromChain,
  livePauseDeps,
  readBookStates,
  runPausePass,
  type BookAtExpiry,
  type PauseDeps,
} from "./phoenix/pauseAtExpiry";
import { PhoenixMarketStatus, seatManagerHandoffIxs } from "./phoenix/seatManager";
import { authorityReport, planHandoff } from "./phoenix/handoff";
import { fetchUpdateAt } from "./pyth/hermes";
import { adminPriceMaxSkewSecs, decideAdminFallbackPrice } from "./pyth/adminFallback";
import { loadPauseMemory, savePauseMemory } from "./phoenix/pauseMemoryStore";

const DRY = process.env.DRY_RUN === "1";
const log = (msg: string, extra?: unknown) => console.log(`[ops] ${extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`}`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => a === name && process.argv[i + 1] && out.push(process.argv[i + 1]));
  return out;
}

export function booksFromState(file: string): { books: BookAtExpiry[]; complete: boolean } {
  if (!fs.existsSync(file)) return { books: [], complete: false }; // fresh staging: nothing bootstrapped yet
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const books = (s.markets ?? [])
    .filter((m: any) => m.phoenixMarket)
    .map((m: any) => ({
      strikeMarket: new PublicKey(m.market),
      phoenixMarket: new PublicKey(m.phoenixMarket),
      expiryTs: Number(m.expiryTs),
      label: `${m.short ? "[20-min] " : ""}${m.symbol}>=${Number(m.strikeE6) / 1e6}`,
    }));
  // The 20-min market is added later (on Debu's START); the watcher keeps going until it's in or skipped.
  return { books, complete: !!(s.shortBootstrappedAt || s.shortSkipped) };
}

/**
 * N-1 (Reviewers !78): pause-watch's --exit-when-paused check. A torn / unreadable state file (bootstrap writing it)
 * is a [pause] ALERT and "not complete", never an exception that kills the nohup'd watcher.
 */
export function stateComplete(file: string, alert: (msg: string) => void): boolean {
  try {
    return booksFromState(file).complete;
  } catch (e) {
    alert(`state file ${file} could not be read (${String(e instanceof Error ? e.message : e).slice(0, 200)}) — treating as not complete, retrying next pass`);
    return false;
  }
}

const pauseAlert = (msg: string) => console.error(`[pause] ALERT ${msg}`);

function pauserKeypair(opts: { checkSeatManagerAuthority?: boolean } = {}): Keypair {
  const raw = process.env.PHOENIX_PAUSER_KEYPAIR;
  if (!raw) throw new Error("PHOENIX_PAUSER_KEYPAIR required");
  const kp = loadKeypairFromEnv(raw);
  // L5: same distinctness rules as the worker's resolvePauser, plus the upgrade key / current SM authority.
  assertPauserDistinct(kp.publicKey, process.env, opts);
  return kp;
}

async function main() {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const stateFile = arg("--state");
  const timing = { leadSecs: cfg.pauseLeadSecs, alertAfterSecs: cfg.pauseAlertSecs, alertRepeatSecs: cfg.pauseAlertRepeatSecs };

  const listBooks = async (): Promise<BookAtExpiry[]> => {
    if (stateFile) return booksFromState(stateFile).books;
    const { program } = createProgram(cfg, Keypair.generate()); // read-only listing
    return listBooksFromChain(program);
  };

  if (cmd === "pause-status") {
    const books = await listBooks();
    const st = await readBookStates(connection, books);
    for (const b of books) {
      const s = st.get(b.phoenixMarket.toBase58());
      log(`book ${b.label}`, {
        phoenix: b.phoenixMarket.toBase58(),
        expiryTs: b.expiryTs,
        status: s?.status == null ? "missing" : PhoenixMarketStatus[s.status],
        seatManagerAuthority: s?.seatManagerAuthority?.toBase58() ?? null,
      });
    }
    const expect = arg("--expect-pauser");
    if (expect) {
      const r = authorityReport(books, st, new PublicKey(expect));
      for (const m of r.mismatches) {
        const id = `${m.book.label ?? m.book.phoenixMarket.toBase58()} (phoenix ${m.book.phoenixMarket.toBase58()})`;
        if (m.reason === "left-psm") {
          console.error(`[pause] ALERT book ${id} left the Seat Manager: Phoenix market authority ${m.marketAuthority?.toBase58() ?? "none (header missing)"} is not the SM PDA — ops can't pause it (handoff can't fix this)`);
        } else {
          console.error(`[pause] ALERT book ${id} seat-manager authority ${m.authority?.toBase58() ?? "none"} != pauser ${expect} — run handoff`);
        }
      }
      log(`pause-status: ${r.onPauser}/${books.length} books have the pauser ${expect} as seat-manager authority and the SM PDA as market authority`);
      if (!r.ok) process.exit(2);
    }
    return;
  }

  if (cmd === "handoff") {
    const pauser = pauserKeypair(); // planHandoff refuses pauser == SEAT_MANAGER_AUTHORITY_KEYPAIR (rotation reuses this path)
    const currentRaw = process.env.SEAT_MANAGER_AUTHORITY_KEYPAIR;
    if (!currentRaw) throw new Error("SEAT_MANAGER_AUTHORITY_KEYPAIR (current seat-manager authority) required for handoff");
    const current = loadKeypairFromEnv(currentRaw);
    const explicit = args("--phoenix").map((p) => ({ strikeMarket: PublicKey.default, phoenixMarket: new PublicKey(p), expiryTs: 0, label: p }));
    const books = explicit.length ? explicit : await listBooks();
    const st = await readBookStates(connection, books);
    log(`handoff: ${books.length} book(s), current ${current.publicKey.toBase58()} → pauser ${pauser.publicKey.toBase58()}${DRY ? " [DRY_RUN]" : ""}`);
    let failed = 0;
    for (const step of planHandoff(books, st, current.publicKey, pauser.publicKey)) {
      const b = step.book;
      if (step.action === "skip-no-psm") { log(`handoff skip ${b.label}: no seat manager (book not under PSM)`); continue; }
      if (step.action === "ok") { log(`handoff ok ${b.label}: pauser ${pauser.publicKey.toBase58()} already SM authority`); continue; }
      if (step.action === "skip-foreign") { console.error(`[pause] ALERT handoff skip ${b.label}: SM authority ${step.authority?.toBase58()} is neither the given current key nor the pauser`); failed++; continue; }
      if (DRY) { log(`[DRY_RUN] would hand off ${b.label}: ${current.publicKey.toBase58()} → ${pauser.publicKey.toBase58()}`); continue; }
      try {
        const tx = new Transaction().add(...seatManagerHandoffIxs({ market: b.phoenixMarket, currentAuthority: current.publicKey, newAuthority: pauser.publicKey }));
        tx.feePayer = current.publicKey;
        const sig = await sendAndConfirmTransaction(connection, tx, [current, pauser], { commitment: "confirmed" });
        log(`handoff ${b.label}: SM authority → pauser ${pauser.publicKey.toBase58()}`, { sig });
      } catch (e) {
        failed++;
        console.error(`[pause] ALERT handoff FAILED for ${b.label}: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
      }
    }
    if (failed) process.exit(2);
    return;
  }

  if (cmd === "pause-once" || cmd === "pause-watch") {
    const pauser = pauserKeypair({ checkSeatManagerAuthority: true });
    // M2: no done-set filter — every book is re-read each pass; memory carries re-pause / authority state.
    // N-3: persisted across restarts (atomic file) for pause-watch.
    const memArg = arg("--memory") ?? process.env.PAUSE_MEMORY_FILE ?? (stateFile ? `${stateFile.replace(/\.json$/, "")}-pause-memory.json` : undefined);
    const memoryFile = cmd === "pause-watch" && memArg && memArg !== "none" ? memArg : undefined;
    let memory = createPauseMemory();
    if (memoryFile) {
      const loaded = loadPauseMemory(memoryFile);
      memory = loaded.memory;
      if (loaded.warning) pauseAlert(loaded.warning);
    }
    const deps: PauseDeps = stateFile
      ? { ...livePauseDeps({ connection, program: undefined as any, pauser }), listBooks }
      : livePauseDeps({ connection, program: createProgram(cfg, pauser).program, pauser });
    if (DRY) deps.sendPause = async (b) => { log(`[DRY_RUN] would pause ${b.label}`); return "dry-run"; };
    const maxMs = Number(arg("--max-hours") ?? "96") * 3600_000;
    const pollMs = Number(process.env.PAUSE_POLL_MS ?? "30000");
    const exitWhenPaused = process.argv.includes("--exit-when-paused");
    const t0 = Date.now();
    log(`${cmd} pauser=${pauser.publicKey.toBase58()} lead=${timing.leadSecs}s alertAfter=${timing.alertAfterSecs}s repeat=${timing.alertRepeatSecs}s source=${stateFile ? "state" : "chain"}${memoryFile ? ` memory=${memoryFile}` : ""}`);
    for (;;) {
      let delayMs = pollMs;
      // N-1: nothing in one iteration (state read, RPC, memory save) may kill the watcher without an ALERT.
      try {
        const r = await runPausePass(deps, pauser.publicKey, timing, memory);
        if (r.passError) console.error(`[ops] pause pass error: ${r.passError.slice(0, 300)}`);
        const pending = r.decisions.filter((d) => d.action !== "done").length - r.paused.length;
        if (cmd === "pause-once") {
          log(`pause-once: paused ${r.paused.length}, failed ${r.failed.length}, still pending ${pending}`);
          if (r.passError || r.failed.length) process.exit(1);
          return;
        }
        if (memoryFile) {
          try {
            savePauseMemory(memoryFile, memory);
          } catch (e) {
            pauseAlert(`pause-watch could not save memory ${memoryFile}: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
          }
        }
        if (exitWhenPaused && pending === 0 && r.decisions.length > 0 && stateFile && stateComplete(stateFile, pauseAlert)) {
          return void log("pause-watch: every book is paused — exiting (--exit-when-paused)");
        }
        if (r.nextDelayMs !== null) delayMs = Math.min(pollMs, r.nextDelayMs + 500);
      } catch (e) {
        if (cmd === "pause-once") throw e;
        pauseAlert(`pause-watch iteration failed (still running, retrying next tick): ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
      }
      if (Date.now() - t0 > maxMs) return void pauseAlert(`pause-watch: --max-hours reached — exiting; books are NO LONGER monitored by this watcher`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  if (cmd === "pull-settle") {
    const m = arg("--market");
    if (!m) throw new Error("--market <strikeMarket> required");
    if (!cfg.settlerKeypairRaw) throw new Error("SETTLER_KEYPAIR required (M3: never the config authority)");
    const settler = loadKeypairFromEnv(cfg.settlerKeypairRaw);
    const { program } = createProgram(cfg, settler);
    const market = new PublicKey(m);
    const acc = await (program.account as any).strikeMarket.fetch(market);
    const c = await (program.account as any).config.fetch(configPda(program.programId)[0]);
    const rule = { windowSecs: publishWindowSecs(BigInt(c.settleMaxStalenessSlots.toString())), maxConfBps: Number(c.settleMaxConfRatioBps) };
    const expiryTs = Number(acc.expiryTs.toString());
    const feedIdHex = Buffer.from(acc.pythFeedId).toString("hex");
    log(`pull-settle market=${market.toBase58()} expiryTs=${expiryTs} settler=${settler.publicKey.toBase58()} hermesKey=${cfg.pythHermesApiKey ? "set" : "MISSING"}`);
    if (DRY) return void log("[DRY_RUN] would fetch the Hermes update at expiry, post it via the Pyth receiver and call settle");
    const r = await settleWithPullOracle(
      { market, expiryTs, feedIdHex, sponsoredFeed: acc.pythPriceFeed ?? null },
      rule,
      livePullSettleDeps({ program, connection, settler, market, hermesUrl: cfg.pythHermesUrl, hermesApiKey: cfg.pythHermesApiKey }),
    );
    if (r.ok) return void log(`PULL_SETTLE_OK via=${r.via}`, { sigs: r.signatures });
    log(`PULL_SETTLE_FAILED reason=${r.reason}${r.needsApiKey ? " (needs PYTH_HERMES_API_KEY)" : ""}`);
    process.exit(3);
  }

  if (cmd === "admin-price") {
    const m = arg("--market");
    if (!m) throw new Error("--market <strikeMarket> required");
    const { program } = createProgram(cfg, Keypair.generate()); // read-only
    const market = new PublicKey(m);
    const acc = await (program.account as any).strikeMarket.fetch(market);
    const c = await (program.account as any).config.fetch(configPda(program.programId)[0]);
    const expiryTs = Number(acc.expiryTs.toString());
    const feedIdHex = Buffer.from(acc.pythFeedId).toString("hex");
    const skew = adminPriceMaxSkewSecs(process.env); // !77 L-1: 60 s default (on-chain window), ≤ 300 s override
    if (skew.override) log(skew.override);
    const maxSkewSecs = skew.secs;
    let hermes: { parsed: any } | { error: string };
    try {
      hermes = await fetchUpdateAt({ baseUrl: cfg.pythHermesUrl, apiKey: cfg.pythHermesApiKey, feedIdHex, publishTime: expiryTs });
    } catch (e) {
      hermes = { error: String(e instanceof Error ? e.message : e).slice(0, 200) };
    }
    const d = decideAdminFallbackPrice({
      market: market.toBase58(), expiryTs, feedIdHex, maxSkewSecs, maxConfBps: Number(c.settleMaxConfRatioBps), hermes,
      operator: { priceE6: process.env.OPERATOR_PRICE_E6, source: process.env.OPERATOR_PRICE_SOURCE, market: process.env.OPERATOR_PRICE_MARKET },
    });
    log(`admin-price market=${market.toBase58()} expiryTs=${expiryTs} hermesKey=${cfg.pythHermesApiKey ? "set" : "MISSING"}`);
    if (d.ok) return void console.log(`ADMIN_PRICE_OK price_e6=${d.priceE6} source=${d.source}`);
    console.log(`ADMIN_PRICE_REFUSED reason=${d.reason}`);
    process.exit(4);
  }

  throw new Error(`unknown command ${cmd ?? "(none)"} — see the header of src/ops-cli.ts`);
}

if (require.main === module) {
  main().catch((e) => {
    // N-1: a pause command dying is an incident, not a plain log line.
    const pauseCmd = /^pause-/.test(process.argv[2] ?? "") ? "[pause] ALERT " : "";
    console.error(`${pauseCmd}[ops] fatal: ${String(e instanceof Error ? e.message : e).slice(0, 500)}`);
    process.exit(1);
  });
}
