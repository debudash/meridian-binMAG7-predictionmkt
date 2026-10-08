/**
 * Pause Phoenix books at expiry (review dd46769, "Open risk: Phoenix books stay live after expiry").
 *
 * Mechanism verified against phoenix-seat-manager-v1 (31ad32a) + phoenix-v1 sources:
 *  - The Phoenix market authority is the Seat Manager PDA ([market] under PSMxQb…); Phoenix
 *    ChangeMarketStatus therefore has to go through PSM ix 8, signed by the *seat-manager authority*
 *    (initially the ClaimMarketAuthority payer = the box upgrade key).
 *  - PSM NameSuccessor (6, signed by the current SM authority) + ClaimSeatManagerAuthority (7, signed
 *    by the successor) move that authority to a dedicated pauser key, per market (full SM authority, not pause-only: review mr72-73 M1).
 *  - MarketStatus is Borsh (1-byte variant): Paused = 3 → only reductions (cancel) and withdrawals.
 */
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  decodePhoenixMarketStatus,
  decodeSeatManager,
  PHOENIX_PROGRAM_ID,
  PHOENIX_SEAT_MANAGER_PROGRAM_ID,
  PhoenixMarketStatus,
  phoenixLogAuthority,
  psmChangeMarketStatusIx,
  psmClaimSeatManagerAuthorityIx,
  psmNameSuccessorIx,
  seatManagerAddress,
  seatManagerHandoffIxs,
} from "../src/phoenix/seatManager";
import { followUpDelayMs, nextPauseDelayMs, planPauses, runPausePass, type BookAtExpiry, type BookState } from "../src/phoenix/pauseAtExpiry";
import { booksFromState } from "../src/ops-cli";
import { loadConfig, resolvePauser } from "../src/config";

const market = new PublicKey("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");
const authority = Keypair.generate().publicKey;
const pauser = Keypair.generate().publicKey;

describe("PSM instruction builders (seat-manager-v1 instruction.rs)", () => {
  it("program ids + PDAs: seat manager = PDA([market]) under PSM; log authority = PDA(['log']) under Phoenix", () => {
    expect(PHOENIX_PROGRAM_ID.toBase58()).to.equal("PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY");
    expect(PHOENIX_SEAT_MANAGER_PROGRAM_ID.toBase58()).to.equal("PSMxQbAoDWDbvd9ezQJgARyq6R9L5kJAasaLDVcZwf1");
    const [sm] = PublicKey.findProgramAddressSync([market.toBuffer()], PHOENIX_SEAT_MANAGER_PROGRAM_ID);
    expect(seatManagerAddress(market).toBase58()).to.equal(sm.toBase58());
    const [log] = PublicKey.findProgramAddressSync([Buffer.from("log")], PHOENIX_PROGRAM_ID);
    expect(phoenixLogAuthority().toBase58()).to.equal(log.toBase58());
  });

  it("ChangeMarketStatus (8): data [8, status], accounts phoenix / log / market(w) / seat manager(w) / SM authority (signer)", () => {
    // The PSM IDL lists seat_manager read-only, but Phoenix's ChangeMarketStatus takes its authority
    // (the SM PDA) as AccountMeta::new(.., true): read-only fails the CPI with "writable privilege
    // escalated" (found on localnet, see phoenix-pause.localnet.test.ts).
    const ix = psmChangeMarketStatusIx({ market, authority: pauser, status: PhoenixMarketStatus.Paused });
    expect(ix.programId.toBase58()).to.equal(PHOENIX_SEAT_MANAGER_PROGRAM_ID.toBase58());
    expect([...ix.data]).to.deep.equal([8, 3]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).to.deep.equal([
      [PHOENIX_PROGRAM_ID.toBase58(), false, false],
      [phoenixLogAuthority().toBase58(), false, false],
      [market.toBase58(), false, true],
      [seatManagerAddress(market).toBase58(), false, true],
      [pauser.toBase58(), true, false],
    ]);
  });

  it("NameSuccessor (6): seat manager(w) / current SM authority (signer) / successor", () => {
    const ix = psmNameSuccessorIx({ market, authority, successor: pauser });
    expect([...ix.data]).to.deep.equal([6]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).to.deep.equal([
      [seatManagerAddress(market).toBase58(), false, true],
      [authority.toBase58(), true, false],
      [pauser.toBase58(), false, false],
    ]);
  });

  it("ClaimSeatManagerAuthority (7): seat manager(w) / successor (signer)", () => {
    const ix = psmClaimSeatManagerAuthorityIx({ market, successor: pauser });
    expect([...ix.data]).to.deep.equal([7]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).to.deep.equal([
      [seatManagerAddress(market).toBase58(), false, true],
      [pauser.toBase58(), true, false],
    ]);
  });

  it("handoff = [NameSuccessor, ClaimSeatManagerAuthority] (both signers in one tx); refuses a no-op handoff", () => {
    const ixs = seatManagerHandoffIxs({ market, currentAuthority: authority, newAuthority: pauser });
    expect(ixs.map((i) => i.data[0])).to.deep.equal([6, 7]);
    expect(() => seatManagerHandoffIxs({ market, currentAuthority: pauser, newAuthority: pauser })).to.throw(/differ/);
  });

  it("decoders: Phoenix MarketHeader.status = u64 @ 8; SeatManager = market | authority | successor", () => {
    const hdr = Buffer.alloc(16);
    hdr.writeBigUInt64LE(3n, 8);
    expect(decodePhoenixMarketStatus(hdr)).to.equal(PhoenixMarketStatus.Paused);
    hdr.writeBigUInt64LE(1n, 8);
    expect(decodePhoenixMarketStatus(hdr)).to.equal(PhoenixMarketStatus.Active);
    expect(() => decodePhoenixMarketStatus(Buffer.alloc(8))).to.throw();
    const sm = Buffer.alloc(96 + 8);
    market.toBuffer().copy(sm, 0);
    authority.toBuffer().copy(sm, 32);
    pauser.toBuffer().copy(sm, 64);
    const d = decodeSeatManager(sm);
    expect([d.market.toBase58(), d.authority.toBase58(), d.successor.toBase58()]).to.deep.equal([
      market.toBase58(),
      authority.toBase58(),
      pauser.toBase58(),
    ]);
  });
});

const book = (id: string, expiryTs: number): BookAtExpiry => ({
  strikeMarket: Keypair.generate().publicKey,
  phoenixMarket: new PublicKey(Buffer.alloc(32, Number(id))),
  expiryTs,
  label: `B${id}`,
});
const st = (status: PhoenixMarketStatus | null, auth: PublicKey | null = pauser): BookState => ({ status, seatManagerAuthority: auth });
const states = (pairs: Array<[BookAtExpiry, BookState]>) => new Map(pairs.map(([b, s]) => [b.phoenixMarket.toBase58(), s]));

describe("planPauses: which books to pause now", () => {
  const T = 1_800_000_000;
  it("pauses Active / PostOnly books at expiry (lead 0), waits before, done once Paused/Closed", () => {
    const a = book("1", T), b = book("2", T + 60), c = book("3", T - 600), d = book("4", T - 10);
    const plan = planPauses([a, b, c, d], states([[a, st(PhoenixMarketStatus.Active)], [b, st(PhoenixMarketStatus.Active)],
      [c, st(PhoenixMarketStatus.Paused)], [d, st(PhoenixMarketStatus.PostOnly)]]), pauser, T, {});
    expect(plan.map((p) => [p.book.label, p.action])).to.deep.equal([["B1", "pause"], ["B2", "wait"], ["B3", "done"], ["B4", "pause"]]);
  });

  it("leadSecs pauses early (e.g. 5 s to match the UI cutoff)", () => {
    const a = book("1", T + 5);
    expect(planPauses([a], states([[a, st(PhoenixMarketStatus.Active)]]), pauser, T, { leadSecs: 5 })[0].action).to.equal("pause");
    expect(planPauses([a], states([[a, st(PhoenixMarketStatus.Active)]]), pauser, T, { leadSecs: 4 })[0].action).to.equal("wait");
  });

  it("due but the pauser is NOT the seat-manager authority (handoff missing) → skip + alert, never sends", () => {
    const a = book("1", T - 1);
    const [p] = planPauses([a], states([[a, st(PhoenixMarketStatus.Active, authority)]]), pauser, T, {});
    expect(p.action).to.equal("skip-not-authority");
    expect(p.alert).to.equal(true);
  });

  it("missing / uninitialized book → skip; overdue Active book past alertAfterSecs → alert flag on the pause", () => {
    const a = book("1", T - 1), b = book("2", T - 1), c = book("3", T - 500);
    const plan = planPauses([a, b, c], states([[b, st(PhoenixMarketStatus.Uninitialized)], [c, st(PhoenixMarketStatus.Active)]]), pauser, T, { alertAfterSecs: 120 });
    expect(plan.map((p) => [p.action, !!p.alert])).to.deep.equal([["skip-missing", false], ["skip-uninitialized", false], ["pause", true]]);
  });
});

describe("nextPauseDelayMs: exact-time timer between worker ticks", () => {
  const T = 1_800_000_000;
  it("ms until the earliest still-active book is due (minus lead); null when nothing pending", () => {
    const a = book("1", T + 30), b = book("2", T + 10), c = book("3", T + 5);
    const s = states([[a, st(PhoenixMarketStatus.Active)], [b, st(PhoenixMarketStatus.Active)], [c, st(PhoenixMarketStatus.Paused)]]);
    expect(nextPauseDelayMs([a, b, c], s, T * 1000, {})).to.equal(10_000);
    expect(nextPauseDelayMs([a, b, c], s, T * 1000, { leadSecs: 5 })).to.equal(5_000);
    expect(nextPauseDelayMs([c], s, T * 1000, {})).to.equal(null);
  });
  it("already due → 0", () => {
    const a = book("1", T - 3);
    expect(nextPauseDelayMs([a], states([[a, st(PhoenixMarketStatus.Active)]]), T * 1000, {})).to.equal(0);
  });
});

describe("runPausePass", () => {
  const T = 1_800_000_000;
  it("sends ChangeMarketStatus(Paused) only for due books, logs, and alerts on failures/overdue", async () => {
    const a = book("1", T - 2), b = book("2", T + 100), c = book("3", T - 1);
    const sent: string[] = [];
    const alerts: string[] = [];
    const r = await runPausePass(
      {
        listBooks: async () => [a, b, c],
        readStates: async () => states([[a, st(PhoenixMarketStatus.Active)], [b, st(PhoenixMarketStatus.Active)], [c, st(PhoenixMarketStatus.Active)]]),
        sendPause: async (bk) => {
          if (bk.label === "B3") throw new Error("rpc down");
          sent.push(bk.label!);
          return `sig-${bk.label}`;
        },
        nowUnix: () => T,
        log: () => {},
        alert: (m) => alerts.push(m),
      },
      pauser,
      { alertAfterSecs: 120 },
    );
    expect(sent).to.deep.equal(["B1"]);
    expect(r.paused.map((p) => p.signature)).to.deep.equal(["sig-B1"]);
    expect(r.failed.map((f) => f.book.label)).to.deep.equal(["B3"]);
    expect(alerts.some((m) => /B3/.test(m))).to.equal(true);
    expect(r.nextDelayMs).to.equal(100_000);
  });
});

describe("config: PHOENIX_PAUSER_KEYPAIR (dedicated pauser, never the upgrade key / authority / settler)", () => {
  const asEnv = (kp: Keypair) => JSON.stringify(Array.from(kp.secretKey));
  const base = (cluster: string) => ({ SOLANA_CLUSTER: cluster, SOLANA_RPC_URL: "http://x" }) as any;
  it("reads PHOENIX_PAUSER_KEYPAIR, PHOENIX_PAUSE_LEAD_SECS (0), PHOENIX_PAUSE_ALERT_SECS (120)", () => {
    const p = Keypair.generate();
    const c = loadConfig({ ...base("devnet"), PHOENIX_PAUSER_KEYPAIR: asEnv(p), PHOENIX_PAUSE_LEAD_SECS: "5" });
    expect(c.pauserKeypairRaw).to.equal(asEnv(p));
    expect(c.pauseLeadSecs).to.equal(5);
    expect(c.pauseAlertSecs).to.equal(120);
    expect(loadConfig(base("devnet")).pauseLeadSecs).to.equal(0);
  });
  it("resolvePauser: separate key used; equal to authority or settler refused; unset → null off mainnet, throws on mainnet", () => {
    const a = Keypair.generate(), s = Keypair.generate(), p = Keypair.generate();
    const r = resolvePauser(loadConfig({ ...base("devnet"), PHOENIX_PAUSER_KEYPAIR: asEnv(p) }), a, s);
    expect(r!.publicKey.toBase58()).to.equal(p.publicKey.toBase58());
    expect(() => resolvePauser(loadConfig({ ...base("devnet"), PHOENIX_PAUSER_KEYPAIR: asEnv(a) }), a, s)).to.throw(/must differ/);
    expect(() => resolvePauser(loadConfig({ ...base("devnet"), PHOENIX_PAUSER_KEYPAIR: asEnv(s) }), a, s)).to.throw(/must differ/);
    expect(resolvePauser(loadConfig(base("devnet")), a, s)).to.equal(null);
    expect(() => resolvePauser(loadConfig(base("mainnet-beta")), a, s)).to.throw(/PHOENIX_PAUSER_KEYPAIR required/);
  });
});

describe("ops/lib/psm.cjs parity (devnet-bootstrap handoff uses the same bytes/keys)", () => {
  it("builds identical NameSuccessor / ClaimSeatManagerAuthority / ChangeMarketStatus instructions", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const psm = require("../../../ops/lib/psm.cjs")(require("@solana/web3.js"));
    const norm = (ix: any) => ({ p: ix.programId.toBase58(), d: [...ix.data], k: ix.keys.map((k: any) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]) });
    expect(norm(psm.nameSuccessorIx(market, authority, pauser))).to.deep.equal(norm(psmNameSuccessorIx({ market, authority, successor: pauser })));
    expect(norm(psm.claimSeatManagerAuthorityIx(market, pauser))).to.deep.equal(norm(psmClaimSeatManagerAuthorityIx({ market, successor: pauser })));
    expect(norm(psm.changeMarketStatusIx(market, pauser, 3))).to.deep.equal(norm(psmChangeMarketStatusIx({ market, authority: pauser, status: PhoenixMarketStatus.Paused })));
    expect(psm.decodeSeatManagerAuthority(Buffer.concat([market.toBuffer(), pauser.toBuffer(), authority.toBuffer()])).toBase58()).to.equal(pauser.toBase58());
  });
});

describe("worker follow-up timer + ops state source", () => {
  it("followUpDelayMs: schedule an exact-time pass only if the next book is due before the next tick (+500 ms slack)", () => {
    expect(followUpDelayMs(10_000, 60_000)).to.equal(10_500);
    expect(followUpDelayMs(0, 60_000)).to.equal(500);
    expect(followUpDelayMs(59_000, 60_000)).to.equal(59_500);
    expect(followUpDelayMs(60_000, 60_000)).to.equal(null);
    expect(followUpDelayMs(null, 60_000)).to.equal(null);
  });
  it("booksFromState: staging state markets with a book; complete once the 20-min market exists or was skipped", () => {
    const fs = require("fs") as typeof import("fs");
    const os = require("os") as typeof import("os");
    const path = require("path") as typeof import("path");
    const f = path.join(os.tmpdir(), `pause-state-${process.pid}.json`);
    const sm = Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(f, JSON.stringify({ markets: [
      { market: sm, symbol: "AAPL", strikeE6: 305e6, expiryTs: 100, phoenixMarket: market.toBase58() },
      { market: Keypair.generate().publicKey.toBase58(), symbol: "MSFT", strikeE6: 495e6, expiryTs: 100 },
    ] }));
    let r = booksFromState(f);
    expect(r.books.map((b) => [b.label, b.phoenixMarket.toBase58(), b.expiryTs])).to.deep.equal([["AAPL>=305", market.toBase58(), 100]]);
    expect(r.complete).to.equal(false);
    fs.writeFileSync(f, JSON.stringify({ markets: [], shortSkipped: true }));
    expect(booksFromState(f).complete).to.equal(true);
    fs.unlinkSync(f);
  });
});
