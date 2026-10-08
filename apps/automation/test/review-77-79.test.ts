/**
 * Reviewers !77 / !78 / !79 follow-up (meridian-review-mr77-79.md):
 *  N-1  pause-watch survives a torn state file ([pause] ALERT, no crash); bootstrap / settle-test write state atomically.
 *  N-2  books that left PSM get no pause send (skip-left-psm); "went Active again" / "pause FAILED" are rate-limited.
 *  N-3  pause memory persists across restarts (atomic file); SM authority != pauser alerts for every listed book.
 *  N-4  a failed first pass (no listing yet) is a [pause] ALERT.
 *  N-5 / !77 L-4  --expect-pauser also requires the Phoenix header authority == the Seat Manager PDA.
 *  !77 L-1  ADMIN_PRICE_MAX_SKEW_SECS defaults to 60 s (on-chain window), max 300 s with a logged override.
 *  !77 L-2  settle-test.cjs admin_settle needs ADMIN_PRICE_MARKET == the market being settled.
 *  !77 L-3  EXPECTED_PAUSER_PUB pinned in staging.env; handoff aborts on a mismatch.
 *  R-1/2/3  rotation runbook: offline keygen, no-pauser window, attacker race.
 *  !79      design note records the Reviewers' answers and the M1-closing conditions.
 */
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createPauseMemory,
  planPauses,
  runPausePass,
  type BookAtExpiry,
  type BookState,
  type PauseDeps,
} from "../src/phoenix/pauseAtExpiry";
import { loadPauseMemory, savePauseMemory } from "../src/phoenix/pauseMemoryStore";
import { writeFileAtomicSync } from "../src/util/atomicWrite";
import { PhoenixMarketStatus, seatManagerAddress } from "../src/phoenix/seatManager";
import { authorityReport } from "../src/phoenix/handoff";
import { adminPriceMaxSkewSecs } from "../src/pyth/adminFallback";
import { booksFromState, stateComplete } from "../src/ops-cli";
import { loadConfig } from "../src/config";

const ROOT = path.join(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const codeOf = (f: string) => read(f).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { writeFileAtomicSync: writeFileAtomicCjs } = require("../../../ops/lib/atomic-write.cjs") as {
  writeFileAtomicSync: (file: string, data: string, mode?: number) => void;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { adminPriceGuard } = require("../../../ops/lib/admin-price.cjs") as {
  adminPriceGuard: (o: { priceE6?: string; source?: string; market?: string; expectedMarket?: string }) => { ok: boolean; reason?: string; line?: string };
};

const T = 1_800_000_000;
const pauser = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const book = (n: number, expiryTs = T - 10): BookAtExpiry => ({
  strikeMarket: Keypair.generate().publicKey,
  phoenixMarket: new PublicKey(Buffer.alloc(32, n)),
  expiryTs,
  label: `R${n}`,
});
const okState = (b: BookAtExpiry, status: PhoenixMarketStatus, sm: PublicKey | null = pauser): BookState => ({
  status,
  seatManagerAuthority: sm,
  marketAuthority: seatManagerAddress(b.phoenixMarket),
});
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "rev7779-"));

function harness(books: BookAtExpiry[], initial: Map<string, BookState>, now = T) {
  const states = initial;
  const sent: string[] = [];
  const alerts: string[] = [];
  let clock = now;
  let failSend: string | null = null;
  const deps: PauseDeps = {
    listBooks: async () => books,
    readStates: async () => new Map(states),
    sendPause: async (b) => {
      sent.push(b.label!);
      if (failSend) throw new Error(failSend);
      states.set(b.phoenixMarket.toBase58(), { ...states.get(b.phoenixMarket.toBase58())!, status: PhoenixMarketStatus.Paused });
      return `sig-${b.label}`;
    },
    nowUnix: () => clock,
    log: () => {},
    alert: (m) => alerts.push(m),
  };
  return { deps, states, sent, alerts, tick: (s: number) => (clock += s), failSends: (m: string | null) => (failSend = m) };
}

describe("N-1: a torn state file never kills pause-watch", () => {
  it("booksFromState throws on torn JSON; stateComplete returns false and raises [pause] ALERT", () => {
    const d = tmpdir();
    const f = path.join(d, "state.json");
    fs.writeFileSync(f, '{"markets":[{"market":"');
    expect(() => booksFromState(f)).to.throw();
    const alerts: string[] = [];
    expect(stateComplete(f, (m) => alerts.push(m))).to.equal(false);
    expect(alerts.join("\n")).to.match(/state file .*could not be read/);
  });
  it("a torn read during the pass (listBooks throws) is a [pause] ALERT, not a rejection", async () => {
    const d = tmpdir();
    const f = path.join(d, "state.json");
    fs.writeFileSync(f, "{");
    const h = harness([], new Map());
    h.deps.listBooks = async () => booksFromState(f).books;
    const r = await runPausePass(h.deps, pauser, {}, createPauseMemory());
    expect(r.passError).to.be.a("string");
    expect(h.alerts.join("\n")).to.match(/pause pass FAILED/);
  });
  it("ops-cli pause-watch computes `complete` via stateComplete (inside try/catch) and the loop body is guarded", () => {
    const src = read("apps/automation/src/ops-cli.ts");
    expect(src).to.not.match(/booksFromState\(stateFile\)\.complete/);
    expect(src).to.match(/stateComplete\(stateFile/);
    expect(src).to.match(/const pauseAlert = \(msg: string\) => console\.error\(`\[pause\] ALERT \$\{msg\}`\)/);
    expect(src).to.match(/pauseAlert\(`pause-watch iteration failed/);
  });
  for (const [label, writer] of [["src/util/atomicWrite.ts", writeFileAtomicSync], ["ops/lib/atomic-write.cjs", writeFileAtomicCjs]] as const) {
    it(`${label}: writes via a same-dir temp file + rename (no partial file, no temp left behind)`, () => {
      const d = tmpdir();
      const f = path.join(d, "s.json");
      fs.writeFileSync(f, "old");
      writer(f, JSON.stringify({ a: 1 }), 0o600);
      expect(JSON.parse(fs.readFileSync(f, "utf8"))).to.deep.equal({ a: 1 });
      expect(fs.readdirSync(d)).to.deep.equal(["s.json"]);
      expect(fs.statSync(f).mode & 0o777).to.equal(0o600);
    });
  }
  it("devnet-bootstrap.cjs save() and settle-test.cjs write the state atomically", () => {
    const b = read("ops/devnet-bootstrap.cjs");
    const save = b.match(/const save = \(\) => \{[^\n]*\};/)?.[0] ?? "";
    expect(save).to.match(/writeFileAtomicSync\(STATE/);
    expect(save).to.not.match(/fs\.writeFileSync\(STATE/);
    expect(b).to.match(/require\("\.\/lib\/atomic-write\.cjs"\)/);
    const s = read("ops/settle-test.cjs");
    expect(s).to.not.match(/fs\.writeFileSync\(STATE/);
    expect(s).to.match(/writeFileAtomicSync\(STATE/);
  });
  it("the atomic writer fsyncs the temp file before rename", () => {
    expect(read("ops/lib/atomic-write.cjs")).to.match(/fsyncSync[\s\S]*renameSync/);
    expect(read("apps/automation/src/util/atomicWrite.ts")).to.match(/fsyncSync[\s\S]*renameSync/);
  });
});

describe("N-2: books that left PSM are not spammed", () => {
  it("planPauses: a due Active book whose market authority is not the SM PDA → skip-left-psm (no send)", () => {
    const b = book(1);
    const s = { ...okState(b, PhoenixMarketStatus.Active), marketAuthority: other };
    const d = planPauses([b], new Map([[b.phoenixMarket.toBase58(), s]]), pauser, T, {});
    expect(d[0].action).to.equal("skip-left-psm");
  });
  it("a left-PSM book alerts once per repeat window over many ticks, and nothing is sent", async () => {
    const b = book(2);
    const s = { ...okState(b, PhoenixMarketStatus.Paused), marketAuthority: other };
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), s]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem); // seen Paused once
    h.states.set(b.phoenixMarket.toBase58(), { ...s, status: PhoenixMarketStatus.Active }); // attacker unpaused via Phoenix 103
    for (let i = 0; i < 100; i++) {
      h.tick(30);
      await runPausePass(h.deps, pauser, {}, mem);
    }
    expect(h.sent).to.deep.equal([]);
    expect(h.alerts.length).to.be.lessThan(4);
    expect(h.alerts.join("\n")).to.match(/not the Seat Manager PDA/);
    expect(h.alerts.join("\n")).to.match(/R2 .*went Active again.*left the Seat Manager/);
  });
  it("repeated 'pause FAILED' / 'went Active again' alerts are rate-limited per book (configurable repeat)", async () => {
    const b = book(3);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active)]]));
    h.failSends("simulation failed: custom program error 0x1");
    const mem = createPauseMemory();
    for (let i = 0; i < 20; i++) {
      await runPausePass(h.deps, pauser, { alertRepeatSecs: 600 }, mem);
      h.tick(30);
    }
    expect(h.sent.length).to.equal(20); // still retried every pass
    expect(h.alerts.filter((a) => /pause FAILED/.test(a)).length).to.equal(1);
    h.tick(600);
    await runPausePass(h.deps, pauser, { alertRepeatSecs: 600 }, mem);
    expect(h.alerts.filter((a) => /pause FAILED/.test(a)).length).to.equal(2);
  });
  it("PHOENIX_PAUSE_ALERT_REPEAT_SECS is validated (60..86400, default 3600)", () => {
    const base = { SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any;
    expect(loadConfig(base).pauseAlertRepeatSecs).to.equal(3600);
    expect(loadConfig({ ...base, PHOENIX_PAUSE_ALERT_REPEAT_SECS: "900" }).pauseAlertRepeatSecs).to.equal(900);
    expect(() => loadConfig({ ...base, PHOENIX_PAUSE_ALERT_REPEAT_SECS: "5" })).to.throw(/PHOENIX_PAUSE_ALERT_REPEAT_SECS/);
  });
});

describe("N-3: alert memory survives restarts", () => {
  it("save/load round-trips pausedOnce, onPauser, lastAlert and lastBooks (atomic file, 0600)", () => {
    const d = tmpdir();
    const f = path.join(d, "mem.json");
    const m = createPauseMemory();
    const b = book(4);
    m.pausedOnce.add(b.phoenixMarket.toBase58());
    m.onPauser.add(b.phoenixMarket.toBase58());
    m.lastAlert.set("mkt:x:y", T);
    m.lastBooks = [b];
    savePauseMemory(f, m);
    expect(fs.statSync(f).mode & 0o777).to.equal(0o600);
    const back = loadPauseMemory(f);
    expect([...back.memory.pausedOnce]).to.deep.equal([b.phoenixMarket.toBase58()]);
    expect([...back.memory.onPauser]).to.deep.equal([b.phoenixMarket.toBase58()]);
    expect(back.memory.lastAlert.get("mkt:x:y")).to.equal(T);
    expect(back.memory.lastBooks[0].phoenixMarket.toBase58()).to.equal(b.phoenixMarket.toBase58());
    expect(back.memory.lastBooks[0].expiryTs).to.equal(b.expiryTs);
  });
  it("alert timestamps older than 7 days are pruned on save (file can't grow forever)", () => {
    const d = tmpdir();
    const f = path.join(d, "mem.json");
    const m = createPauseMemory();
    m.lastAlert.set("old", T - 8 * 86400);
    m.lastAlert.set("new", T - 60);
    savePauseMemory(f, m, T);
    expect([...loadPauseMemory(f).memory.lastAlert.keys()]).to.deep.equal(["new"]);
  });
  it("a missing file is a fresh memory; a corrupt file is a fresh memory + warning (never a crash)", () => {
    const d = tmpdir();
    expect(loadPauseMemory(path.join(d, "nope.json")).warning).to.equal(undefined);
    fs.writeFileSync(path.join(d, "bad.json"), "{");
    const r = loadPauseMemory(path.join(d, "bad.json"));
    expect(r.memory.pausedOnce.size).to.equal(0);
    expect(r.warning).to.match(/could not be read/);
  });
  it("after a restart with persisted memory, an SM-authority change still reads 'CHANGED away from the pauser'", async () => {
    const d = tmpdir();
    const f = path.join(d, "mem.json");
    const b = book(5);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Paused)]]));
    const m1 = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, m1);
    savePauseMemory(f, m1);
    h.states.set(b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active, other));
    await runPausePass(h.deps, pauser, {}, loadPauseMemory(f).memory); // "restarted" watcher
    expect(h.alerts.join("\n")).to.match(/R5 .*CHANGED away from the pauser/);
  });
  it("without memory, a pre-expiry book whose SM authority isn't the pauser still alerts (rate-limited)", async () => {
    const b = book(6, T + 7200);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active, other)]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    h.tick(30);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.filter((a) => /R6 .*seat-manager authority .* is not the pauser/.test(a)).length).to.equal(1);
  });
  it("ops-cli pause-watch loads + saves the memory file next to the state (--memory overrides)", () => {
    const src = read("apps/automation/src/ops-cli.ts");
    expect(src).to.match(/loadPauseMemory\(/);
    expect(src).to.match(/savePauseMemory\(/);
    expect(src).to.match(/--memory/);
  });
});

describe("N-4: the first pass after start alerts on failure", () => {
  it("no previous listing + list failure → [pause] ALERT", async () => {
    const h = harness([], new Map());
    h.deps.listBooks = async () => {
      throw new Error("rpc down at start");
    };
    const r = await runPausePass(h.deps, pauser, {}, createPauseMemory());
    expect(r.passError).to.match(/rpc down/);
    expect(h.alerts.join("\n")).to.match(/pause pass FAILED .*no successful listing yet.*rpc down at start/);
  });
  it("consecutive failures with no due book alert after 3 in a row", async () => {
    const later = book(7, T + 86400);
    const h = harness([later], new Map([[later.phoenixMarket.toBase58(), okState(later, PhoenixMarketStatus.Active)]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    h.deps.readStates = async () => {
      throw new Error("429");
    };
    await runPausePass(h.deps, pauser, {}, mem);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.filter((a) => /pause pass FAILED/.test(a)).length).to.equal(0);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.filter((a) => /pause pass FAILED .*3 consecutive/.test(a)).length).to.equal(1);
  });
});

describe("N-5 / !77 L-4: --expect-pauser checks the Phoenix market authority too", () => {
  it("the Reviewers' PoC book (SM authority = pauser, header authority = attacker) fails the gate", () => {
    const b = book(8);
    const states = new Map<string, BookState>([[b.phoenixMarket.toBase58(), { ...okState(b, PhoenixMarketStatus.Active), marketAuthority: other }]]);
    const r = authorityReport([b], states, pauser);
    expect(r.ok).to.equal(false);
    expect(r.onPauser).to.equal(0);
    expect(r.mismatches[0].reason).to.equal("left-psm");
  });
  it("SM authority = pauser and header authority = SM PDA passes", () => {
    const b = book(9);
    const r = authorityReport([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active)]]), pauser);
    expect(r.ok).to.equal(true);
  });
  it("a missing Phoenix header (null authority) fails the gate", () => {
    const b = book(10);
    const r = authorityReport([b], new Map([[b.phoenixMarket.toBase58(), { ...okState(b, PhoenixMarketStatus.Active), marketAuthority: null }]]), pauser);
    expect(r.ok).to.equal(false);
  });
  it("ops-cli prints a left-PSM ALERT line for those books", () => {
    expect(read("apps/automation/src/ops-cli.ts")).to.match(/left the Seat Manager/);
  });
});

describe("!77 L-1: admin price skew matches the on-chain 60 s window", () => {
  it("defaults to 60 s; up to 300 s only with a logged override; above 300 or junk throws", () => {
    expect(adminPriceMaxSkewSecs({})).to.deep.equal({ secs: 60 });
    const o = adminPriceMaxSkewSecs({ ADMIN_PRICE_MAX_SKEW_SECS: "300" });
    expect(o.secs).to.equal(300);
    expect(o.override).to.match(/override/i);
    expect(adminPriceMaxSkewSecs({ ADMIN_PRICE_MAX_SKEW_SECS: "30" })).to.deep.equal({ secs: 30 });
    expect(() => adminPriceMaxSkewSecs({ ADMIN_PRICE_MAX_SKEW_SECS: "600" })).to.throw(/0\.\.300/);
    expect(() => adminPriceMaxSkewSecs({ ADMIN_PRICE_MAX_SKEW_SECS: "1m" })).to.throw(/0\.\.300/);
  });
  it("ops-cli uses it; no 600 s default left in ops / docs", () => {
    expect(read("apps/automation/src/ops-cli.ts")).to.match(/adminPriceMaxSkewSecs\(/);
    expect(read("apps/automation/src/ops-cli.ts")).to.not.match(/ADMIN_PRICE_MAX_SKEW_SECS \?\? "600"/);
    for (const f of ["ops/run-staging.sh", "ops/README.md", "ops/staging.env.example", "docs/STAGING_TEST_PLAN.md"]) {
      expect(read(f), f).to.not.match(/SKEW_SECS[^\n]{0,20}600|600 s of expiry|±600 s/);
    }
  });
});

describe("!77 L-2: manual settle-test admin_settle is bound to the market", () => {
  it("adminPriceGuard requires ADMIN_PRICE_MARKET == the market being settled", () => {
    const M = "8jvYJm4n3o3Xc6bDdGtS7gS6GmN4V8WgYwF8gk3vM4u7";
    expect(adminPriceGuard({ priceE6: "1", source: "x", expectedMarket: M }).reason).to.match(/ADMIN_PRICE_MARKET/);
    expect(adminPriceGuard({ priceE6: "1", source: "x", market: "other", expectedMarket: M }).ok).to.equal(false);
    expect(adminPriceGuard({ priceE6: "1", source: "x", market: M, expectedMarket: M }).ok).to.equal(true);
  });
  it("settle-test.cjs passes the market; run-staging.sh sets ADMIN_PRICE_MARKET=$SM", () => {
    expect(read("ops/settle-test.cjs")).to.match(/expectedMarket: sm\.toBase58\(\)/);
    expect(codeOf("ops/run-staging.sh")).to.match(/ADMIN_PRICE_MARKET=\$SM/);
  });
});

describe("!77 L-3: expected pauser pinned in staging.env", () => {
  const code = codeOf("ops/run-staging.sh");
  it("handoff_repair aborts before any handoff when the pauser key's pubkey != EXPECTED_PAUSER_PUB", () => {
    const fn = code.match(/handoff_repair\(\)\{[\s\S]*?\n\}/)?.[0] ?? "";
    const check = fn.indexOf("EXPECTED_PAUSER_PUB");
    expect(check).to.be.greaterThan(0);
    expect(check).to.be.lessThan(fn.indexOf("ops-cli.js handoff"));
    expect(fn).to.match(/\[pause\] ALERT[^\n]*EXPECTED_PAUSER_PUB/);
  });
  it("the pause watcher refuses to start on a mismatch, and staging.env.example documents the pin", () => {
    expect(code).to.match(/pauser_pin_ok/);
    expect(read("ops/staging.env.example")).to.match(/^EXPECTED_PAUSER_PUB=/m);
  });
});

describe("R-1 / R-2 / R-3: rotation runbook", () => {
  const r = read("docs/runbooks/PAUSER_ROTATION.md");
  it("R-1: key generation + backup happen on the operator's offline machine; no keygen on the box", () => {
    expect(r).to.match(/offline machine/i);
    expect(r).to.match(/never run `solana-keygen new`[^\n]*(box|agent)/i);
    expect(r).to.match(/chmod 600/);
    expect(r).to.match(/scp/);
    const s1 = r.split("## 1.")[1]?.split("## 2.")[0] ?? "";
    // any keygen command in §1 is explicitly on the offline machine
    expect(s1).to.match(/On the offline machine/i);
  });
  it("R-2: names the no-pauser window and how to avoid it", () => {
    expect(r).to.match(/no-pauser window/i);
    expect(r).to.match(/no book expires/i);
  });
  it("R-3: the attacker can race an emergency rotation; 'neither' books are lost", () => {
    expect(r).to.match(/race/i);
    expect(r).to.match(/neither[\s\S]{0,200}lost/i);
  });
});

describe("!79: design note records the Reviewers' answers + M1-closing conditions", () => {
  const d = read("docs/design/phoenix-pause-pda-authority.md");
  it("PSM invoke_signed, CPI depth, seeds, clock, CI grep, migration, bootstrap binding", () => {
    expect(d).to.match(/invoke_signed/);
    expect(d).to.match(/CPI depth[^\n]*4/);
    expect(d).to.match(/b"book_pauser", strike_market/);
    expect(d).to.match(/5 ?s lead/);
    expect(d).to.match(/CI[^\n]*(grep|check)[^\n]*claim_book_pauser/);
    expect(d).to.match(/already[- ]paused/i);
    expect(d).to.match(/bootstrap (tx|transaction)/i);
  });
  it("M1-closing conditions", () => {
    expect(d).to.match(/set-once|write-once/i);
    expect(d).to.match(/multisig/i);
    expect(d).to.match(/timelock/i);
    expect(d).to.match(/close_book/);
    expect(d).to.match(/fee recipient/i);
  });
});

describe("nits", () => {
  it("run-staging.sh cleans up RUN_TMP on exit", () => {
    expect(codeOf("ops/run-staging.sh")).to.match(/trap '[^']*rm -rf "\$RUN_TMP"[^']*' EXIT/);
  });
  it("pyth-read.py --max-age-secs 0900 no longer crashes", () => {
    const py = path.join(ROOT, "ops/pyth-read.py");
    const r = spawnSync("python3", ["-c", `import importlib.util as u;s=u.spec_from_file_location("p","${py}");m=u.module_from_spec(s);s.loader.exec_module(m);print(m.parse_args(["http://x","--max-age-secs","0900"]))`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    expect(r.stderr).to.equal("");
    expect(r.stdout.trim()).to.equal("('http://x', 900)");
  });
});
