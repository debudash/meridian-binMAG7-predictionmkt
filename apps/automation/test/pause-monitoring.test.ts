/**
 * Reviewers mr72-73 (outside-tester fix MR):
 *  M2  paused books stay monitored: a book that goes Active again is re-paused with "[pause] ALERT";
 *      Phoenix market authority ≠ Seat Manager PDA or SM authority ≠ pauser alerts (rate-limited).
 *  L1  pause timing env validated at startup.   L2  per-book decode errors + pass failures alert.
 *  L3  the exact-time follow-up is never lost.  L5  ops-cli pauser distinct from the other keys.
 *  L6  run-staging.sh hygiene.                  nit skip-not-authority rate-limited (1 / book / hour).
 *  Docs: the pauser's real powers; rotation runbook with an offline backup.
 */
import { expect } from "chai";
import fs from "fs";
import path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createPauseMemory,
  readBookStates,
  runPausePass,
  serialRunner,
  type BookAtExpiry,
  type BookState,
  type PauseDeps,
} from "../src/phoenix/pauseAtExpiry";
import { decodePhoenixMarketHeader, PhoenixMarketStatus, seatManagerAddress } from "../src/phoenix/seatManager";
import { assertPauserDistinct, loadConfig } from "../src/config";

const ROOT = path.join(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = 1_800_000_000;
const pauser = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const book = (n: number, expiryTs = T - 10): BookAtExpiry => ({
  strikeMarket: Keypair.generate().publicKey,
  phoenixMarket: new PublicKey(Buffer.alloc(32, n)),
  expiryTs,
  label: `B${n}`,
});
const okState = (b: BookAtExpiry, status: PhoenixMarketStatus, sm: PublicKey | null = pauser): BookState => ({
  status,
  seatManagerAuthority: sm,
  marketAuthority: seatManagerAddress(b.phoenixMarket),
});

function harness(books: BookAtExpiry[], initial: Map<string, BookState>, now = T) {
  const states = initial;
  const sent: string[] = [];
  const alerts: string[] = [];
  let clock = now;
  const deps: PauseDeps = {
    listBooks: async () => books,
    readStates: async () => new Map(states),
    sendPause: async (b) => {
      sent.push(b.label!);
      states.set(b.phoenixMarket.toBase58(), { ...states.get(b.phoenixMarket.toBase58())!, status: PhoenixMarketStatus.Paused });
      return `sig-${b.label}`;
    },
    nowUnix: () => clock,
    log: () => {},
    alert: (m) => alerts.push(m),
  };
  return { deps, states, sent, alerts, tick: (s: number) => (clock += s) };
}

describe("M2: paused books stay monitored", () => {
  it("a book flipped Active after a pass is re-paused and alerted on the next pass", async () => {
    const b = book(1);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active)]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.sent).to.deep.equal(["B1"]);
    expect(h.alerts).to.deep.equal([]);
    // someone (leaked key / operator) sets it Active again
    h.states.set(b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active));
    h.tick(60);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.sent).to.deep.equal(["B1", "B1"]);
    expect(h.alerts.some((a) => /B1 .*went Active again after it was paused.*re-pausing/.test(a))).to.equal(true);
  });

  it("a book already Paused when first seen is still re-read and re-paused if it goes Active", async () => {
    const b = book(2);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Paused)]]));
    const mem = createPauseMemory();
    const r1 = await runPausePass(h.deps, pauser, {}, mem);
    expect(r1.decisions.map((d) => d.action)).to.deep.equal(["done"]);
    h.states.set(b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active));
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.sent).to.deep.equal(["B2"]);
    expect(h.alerts.join("\n")).to.match(/went Active again/);
  });

  it("alerts when the SM authority moves away from the pauser (even on a Paused book)", async () => {
    const b = book(3);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Paused)]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    h.states.set(b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Paused, other));
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.some((a) => /B3 .*seat-manager authority changed from the pauser .* to /.test(a))).to.equal(true);
  });

  it("alerts when the Phoenix market authority is no longer the Seat Manager PDA (book left PSM)", async () => {
    const b = book(4);
    const s = { ...okState(b, PhoenixMarketStatus.Paused), marketAuthority: other };
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), s]]));
    await runPausePass(h.deps, pauser, {}, createPauseMemory());
    expect(h.alerts.some((a) => /B4 .*Phoenix market authority .* is not the Seat Manager PDA/.test(a))).to.equal(true);
  });

  it("authority alerts are rate-limited to once per book per hour (re-alert at once if the value changes)", async () => {
    const b = book(5);
    const s = { ...okState(b, PhoenixMarketStatus.Paused), marketAuthority: other };
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), s]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    h.tick(60);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.length).to.equal(1);
    const third = Keypair.generate().publicKey;
    h.states.set(b.phoenixMarket.toBase58(), { ...s, marketAuthority: third });
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.length).to.equal(2);
    h.tick(3601);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.length).to.equal(3);
  });

  it("nit: skip-not-authority (handoff missing) alerts once per book per hour, not every tick", async () => {
    const b = book(6);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Active, other)]]));
    const mem = createPauseMemory();
    for (let i = 0; i < 5; i++) {
      await runPausePass(h.deps, pauser, {}, mem);
      h.tick(60);
    }
    expect(h.sent).to.deep.equal([]);
    expect(h.alerts.filter((a) => /run the handoff/.test(a)).length).to.equal(1);
    h.tick(3600);
    await runPausePass(h.deps, pauser, {}, mem);
    expect(h.alerts.filter((a) => /run the handoff/.test(a)).length).to.equal(2);
  });

  it("decodePhoenixMarketHeader reads status @8 and authority @208 (240-byte slice)", () => {
    const d = Buffer.alloc(240);
    d.writeBigUInt64LE(3n, 8);
    other.toBuffer().copy(d, 208);
    const h = decodePhoenixMarketHeader(d);
    expect(h.status).to.equal(PhoenixMarketStatus.Paused);
    expect(h.authority!.toBase58()).to.equal(other.toBase58());
    expect(decodePhoenixMarketHeader(d.subarray(0, 16)).authority).to.equal(null);
  });
});

describe("L2: one bad book or a failed pass still raises [pause] ALERT", () => {
  it("readBookStates: a short/unknown header becomes a per-book error, other books decode", async () => {
    const a = book(7), b = book(8);
    const good = Buffer.alloc(240);
    good.writeBigUInt64LE(1n, 8);
    seatManagerAddress(a.phoenixMarket).toBuffer().copy(good, 208);
    const bad = Buffer.alloc(240);
    bad.writeBigUInt64LE(99n, 8);
    const sm = Buffer.concat([a.phoenixMarket.toBuffer(), pauser.toBuffer(), pauser.toBuffer()]);
    const conn = {
      getMultipleAccountsInfo: async (keys: PublicKey[], opts: any) =>
        keys.map((k, i) => (opts.dataSlice.length === 96 ? { data: sm } : { data: i === 0 ? good : bad })),
    };
    const m = await readBookStates(conn as any, [a, b]);
    expect(m.get(a.phoenixMarket.toBase58())!.status).to.equal(PhoenixMarketStatus.Active);
    expect(m.get(a.phoenixMarket.toBase58())!.marketAuthority!.toBase58()).to.equal(seatManagerAddress(a.phoenixMarket).toBase58());
    expect(m.get(b.phoenixMarket.toBase58())!.status).to.equal(null);
    expect(m.get(b.phoenixMarket.toBase58())!.error).to.match(/Unknown Phoenix market status 99/);
  });

  it("a due book whose state failed to decode → skip-missing + ALERT", async () => {
    const b = book(9);
    const h = harness([b], new Map([[b.phoenixMarket.toBase58(), { status: null, seatManagerAuthority: null, error: "short data" }]]));
    const r = await runPausePass(h.deps, pauser, {}, createPauseMemory());
    expect(r.decisions[0].action).to.equal("skip-missing");
    expect(h.alerts.join("\n")).to.match(/B9 .*could not be read.*short data/);
  });

  it("an RPC failure doesn't reject: ALERT names the due books (from the last good listing)", async () => {
    const b = book(10), later = book(11, T + 3600);
    const h = harness([b, later], new Map([[b.phoenixMarket.toBase58(), okState(b, PhoenixMarketStatus.Paused)], [later.phoenixMarket.toBase58(), okState(later, PhoenixMarketStatus.Active)]]));
    const mem = createPauseMemory();
    await runPausePass(h.deps, pauser, {}, mem);
    h.deps.readStates = async () => {
      throw new Error("429 Too Many Requests");
    };
    const r = await runPausePass(h.deps, pauser, {}, mem);
    expect(r.passError).to.match(/429/);
    expect(h.alerts.some((a) => /pause pass FAILED while 1 book\(s\) due \(B10\).*429/.test(a))).to.equal(true);
    h.deps.listBooks = async () => {
      throw new Error("rpc down");
    };
    const r2 = await runPausePass(h.deps, pauser, {}, mem);
    expect(r2.passError).to.match(/rpc down/);
    expect(h.alerts.some((a) => /pause pass FAILED while 1 book\(s\) due \(B10\).*rpc down/.test(a))).to.equal(true);
  });
});

describe("L3: exact-time follow-up is never lost", () => {
  it("serialRunner: a call while a run is in flight triggers one more run afterwards", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = serialRunner(async () => {
      runs++;
      if (runs === 1) await gate;
    });
    const first = run();
    await run(); // timer fires while the tick's pass is running → returns at once, flags a rerun
    await run();
    expect(runs).to.equal(1);
    release();
    await first;
    expect(runs).to.equal(2); // exactly one extra pass, not lost, not duplicated
  });
});

describe("L1: pause timing env is validated at startup", () => {
  const base = { SOLANA_CLUSTER: "devnet", SOLANA_RPC_URL: "http://x" } as any;
  it("accepts plain integers in range", () => {
    const c = loadConfig({ ...base, PHOENIX_PAUSE_LEAD_SECS: "5", PHOENIX_PAUSE_ALERT_SECS: "120" });
    expect([c.pauseLeadSecs, c.pauseAlertSecs]).to.deep.equal([5, 120]);
  });
  for (const bad of ["5s", "abc", "-1", "301", "1.5", ""]) {
    it(`PHOENIX_PAUSE_LEAD_SECS=${JSON.stringify(bad)} throws`, () => {
      expect(() => loadConfig({ ...base, PHOENIX_PAUSE_LEAD_SECS: bad })).to.throw(/PHOENIX_PAUSE_LEAD_SECS must be an integer in \[0, 300\]/);
    });
  }
  for (const bad of ["9", "x", "-5"]) {
    it(`PHOENIX_PAUSE_ALERT_SECS=${JSON.stringify(bad)} throws`, () => {
      expect(() => loadConfig({ ...base, PHOENIX_PAUSE_ALERT_SECS: bad })).to.throw(/PHOENIX_PAUSE_ALERT_SECS must be an integer in \[10, 86400\]/);
    });
  }
});

describe("L5: ops-cli pauser must differ from the keeper / settler / upgrade key", () => {
  const asEnv = (kp: Keypair) => JSON.stringify(Array.from(kp.secretKey));
  it("refuses a pauser equal to a listed key env or pubkey", () => {
    const p = Keypair.generate(), k = Keypair.generate(), u = Keypair.generate();
    expect(() => assertPauserDistinct(p.publicKey, { AUTOMATION_KEYPAIR: asEnv(k), PAUSER_MUST_DIFFER_FROM: u.publicKey.toBase58() })).to.not.throw();
    expect(() => assertPauserDistinct(p.publicKey, { AUTOMATION_KEYPAIR: asEnv(p) })).to.throw(/must differ from AUTOMATION_KEYPAIR/);
    expect(() => assertPauserDistinct(p.publicKey, { SETTLER_KEYPAIR: asEnv(p) })).to.throw(/must differ from SETTLER_KEYPAIR/);
    expect(() => assertPauserDistinct(p.publicKey, { PAUSER_MUST_DIFFER_FROM: `${u.publicKey.toBase58()},${p.publicKey.toBase58()}` })).to.throw(/must differ from PAUSER_MUST_DIFFER_FROM/);
    expect(() => assertPauserDistinct(p.publicKey, { SEAT_MANAGER_AUTHORITY_KEYPAIR: asEnv(p) }, { checkSeatManagerAuthority: true })).to.throw(/SEAT_MANAGER_AUTHORITY_KEYPAIR/);
  });
  it("ops-cli runs the check for pause-once / pause-watch / handoff", () => {
    const src = read("apps/automation/src/ops-cli.ts");
    expect(src).to.match(/assertPauserDistinct\(/);
    const fn = src.match(/function pauserKeypair[\s\S]*?\n}/)?.[0] ?? "";
    expect(fn).to.match(/assertPauserDistinct/);
  });
  it("run-staging.sh passes the keeper / settler / upgrade pubkeys to ops-cli", () => {
    expect(read("ops/run-staging.sh")).to.match(/PAUSER_MUST_DIFFER_FROM=/);
  });
});

describe("L6: run-staging.sh hygiene", () => {
  const sh = read("ops/run-staging.sh");
  const code = sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("(a) devnet genesis-hash guard before deploy / bootstrap / settle", () => {
    expect(code).to.match(/solana genesis-hash -u "\$RPC"/);
    expect(code).to.match(/EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG/);
    const guard = code.indexOf("assert_devnet\n");
    expect(guard).to.be.greaterThan(0);
    expect(guard).to.be.lessThan(code.indexOf("build_latest_main ||"));
  });
  it("(b) $STATE is never interpolated into inline Python source", () => {
    expect(code).to.not.match(/open\('\$STATE'\)/);
    expect(code).to.not.match(/python3 -c "[^"]*\$STATE/);
  });
  it("(c) no fixed /tmp/stg-* paths (mktemp run dir)", () => {
    expect(code).to.not.match(/\/tmp\/stg-/);
    expect(code).to.match(/mktemp -d/);
  });
  it("(d) the script itself drops the retired workspace token", () => {
    expect(code).to.match(/unset RAILWAY_API_TOKEN/);
  });
  it("(e) trader mint and pause-once failures are logged as ALERTs", () => {
    expect(code).to.match(/settle-test\.cjs mint \) \|\| log "\[settle\] ALERT/);
    expect(code).to.match(/pause-once --state "\$STATE" \|\| log "\[pause\] ALERT/);
  });
});

describe("Docs: pauser powers stated honestly + rotation runbook with offline backup", () => {
  it("ops/README key table lists NameSuccessor / NameMarketAuthoritySuccessor / unpause, no 'low privilege' claim", () => {
    const r = read("ops/README.md");
    const row = r.split("\n").find((l) => l.startsWith("| `pauser.json`")) ?? "";
    expect(row).to.match(/NameSuccessor/);
    expect(row).to.match(/NameMarketAuthoritySuccessor/);
    expect(row).to.match(/unpause|Active/i);
    expect(row).to.not.match(/Can't move user funds\s*\|/);
  });
  it("seatManager.ts header no longer understates the SM authority", () => {
    const s = read("apps/automation/src/phoenix/seatManager.ts");
    expect(s).to.match(/NameMarketAuthoritySuccessor/);
    expect(s).to.not.match(/it can't move user funds to itself\. Not the Meridian/);
  });
  it("a pauser rotation runbook with an offline backup exists and keeps keys out of git", () => {
    const r = read("docs/runbooks/PAUSER_ROTATION.md");
    expect(r).to.match(/offline backup/i);
    expect(r).to.match(/ops-cli\.js handoff/);
    expect(r).to.match(/--expect-pauser/);
    expect(r).to.match(/never commit/i);
    expect(r).not.to.match(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+/); // no key bytes
  });
});
