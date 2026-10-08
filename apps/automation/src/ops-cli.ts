/**
 * Operator CLI for the staging box (ops/run-staging.sh) — same tested code paths as the worker.
 *
 *   node dist/ops-cli.js pause-status [--state <staging-state.json>]      read-only: book status + SM authority
 *   node dist/ops-cli.js pause-once   [--state <file>]                    pause every due book once
 *   node dist/ops-cli.js pause-watch  [--state <file>] [--max-hours 96]   pause each book at its expiry, then exit
 *   node dist/ops-cli.js handoff      [--state <file>] [--phoenix <pk>]…  seat-manager authority → pauser (PSM 6 + 7)
 *   node dist/ops-cli.js pull-settle  --market <strikeMarket>             permissionless settle via Pyth pull oracle
 *
 * Env (never printed): SOLANA_RPC_URL, PHOENIX_PAUSER_KEYPAIR (path or JSON array),
 *   SEAT_MANAGER_AUTHORITY_KEYPAIR (handoff only: the CURRENT seat-manager authority; box only, never Railway),
 *   SETTLER_KEYPAIR + PYTH_HERMES_API_KEY [+ PYTH_HERMES_URL] (pull-settle), MERIDIAN_IDL_PATH / MERIDIAN_PROGRAM_ID
 *   (chain listing / settle), PHOENIX_PAUSE_LEAD_SECS, PHOENIX_PAUSE_ALERT_SECS, DRY_RUN=1 (read-only, no tx).
 * Without --state, books come from the chain (every StrikeMarket with a Phoenix book; needs the prod IDL).
 */
import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadConfig, loadKeypairFromEnv } from "./config";
import { createProgram } from "./solana/client";
import { configPda } from "./solana/pdas";
import { livePullSettleDeps, publishWindowSecs, settleWithPullOracle } from "./solana/pullSettle";
import {
  listBooksFromChain,
  livePauseDeps,
  readBookStates,
  runPausePass,
  type BookAtExpiry,
  type PauseDeps,
} from "./phoenix/pauseAtExpiry";
import { PhoenixMarketStatus, seatManagerHandoffIxs } from "./phoenix/seatManager";

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

function pauserKeypair(): Keypair {
  const raw = process.env.PHOENIX_PAUSER_KEYPAIR;
  if (!raw) throw new Error("PHOENIX_PAUSER_KEYPAIR required");
  return loadKeypairFromEnv(raw);
}

async function main() {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const stateFile = arg("--state");
  const timing = { leadSecs: cfg.pauseLeadSecs, alertAfterSecs: cfg.pauseAlertSecs };

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
    return;
  }

  if (cmd === "handoff") {
    const pauser = pauserKeypair();
    const currentRaw = process.env.SEAT_MANAGER_AUTHORITY_KEYPAIR;
    if (!currentRaw) throw new Error("SEAT_MANAGER_AUTHORITY_KEYPAIR (current seat-manager authority) required for handoff");
    const current = loadKeypairFromEnv(currentRaw);
    const explicit = args("--phoenix").map((p) => ({ strikeMarket: PublicKey.default, phoenixMarket: new PublicKey(p), expiryTs: 0, label: p }));
    const books = explicit.length ? explicit : await listBooks();
    const st = await readBookStates(connection, books);
    for (const b of books) {
      const auth = st.get(b.phoenixMarket.toBase58())?.seatManagerAuthority ?? null;
      if (!auth) { log(`handoff skip ${b.label}: no seat manager (book not under PSM)`); continue; }
      if (auth.equals(pauser.publicKey)) { log(`handoff ok ${b.label}: pauser ${pauser.publicKey.toBase58()} already SM authority`); continue; }
      if (!auth.equals(current.publicKey)) { log(`handoff skip ${b.label}: SM authority ${auth.toBase58()} is neither the given current key nor the pauser`); continue; }
      if (DRY) { log(`[DRY_RUN] would hand off ${b.label}: ${current.publicKey.toBase58()} → ${pauser.publicKey.toBase58()}`); continue; }
      const tx = new Transaction().add(...seatManagerHandoffIxs({ market: b.phoenixMarket, currentAuthority: current.publicKey, newAuthority: pauser.publicKey }));
      tx.feePayer = current.publicKey;
      const sig = await sendAndConfirmTransaction(connection, tx, [current, pauser], { commitment: "confirmed" });
      log(`handoff ${b.label}: SM authority → pauser ${pauser.publicKey.toBase58()}`, { sig });
    }
    return;
  }

  if (cmd === "pause-once" || cmd === "pause-watch") {
    const pauser = pauserKeypair();
    const done = new Set<string>();
    const deps: PauseDeps = stateFile
      ? { ...livePauseDeps({ connection, program: undefined as any, pauser, doneBooks: done }), listBooks: async () => (await listBooks()).filter((b) => !done.has(b.phoenixMarket.toBase58())) }
      : livePauseDeps({ connection, program: createProgram(cfg, pauser).program, pauser, doneBooks: done });
    if (DRY) deps.sendPause = async (b) => { log(`[DRY_RUN] would pause ${b.label}`); return "dry-run"; };
    const maxMs = Number(arg("--max-hours") ?? "96") * 3600_000;
    const pollMs = Number(process.env.PAUSE_POLL_MS ?? "30000");
    const t0 = Date.now();
    log(`${cmd} pauser=${pauser.publicKey.toBase58()} lead=${timing.leadSecs}s alertAfter=${timing.alertAfterSecs}s source=${stateFile ? "state" : "chain"}`);
    for (;;) {
      let next: number | null = null;
      try {
        const r = await runPausePass(deps, pauser.publicKey, timing);
        next = r.nextDelayMs;
        const pending = r.decisions.filter((d) => d.action !== "done").length - r.paused.length;
        if (cmd === "pause-once") return void log(`pause-once: paused ${r.paused.length}, failed ${r.failed.length}, still pending ${pending}`);
        const complete = stateFile ? booksFromState(stateFile).complete : false;
        if (pending === 0 && r.decisions.length > 0 && complete) return void log("pause-watch: every book is paused — exiting");
      } catch (e) {
        console.error(`[ops] pause pass error: ${String(e).slice(0, 300)}`);
        if (cmd === "pause-once") process.exit(1);
      }
      if (Date.now() - t0 > maxMs) return void log("pause-watch: max hours reached — exiting");
      await new Promise((r) => setTimeout(r, next === null ? pollMs : Math.min(pollMs, next + 500)));
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

  throw new Error(`unknown command ${cmd ?? "(none)"} — see the header of src/ops-cli.ts`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[ops] fatal: ${String(e instanceof Error ? e.message : e).slice(0, 500)}`);
    process.exit(1);
  });
}
