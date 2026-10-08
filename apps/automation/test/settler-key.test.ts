/**
 * M3 (Reviewers, !57): permissionless settle must not be signed or paid by the config authority
 * (the key that can pause, update_config and admin_settle). A separate low-balance SETTLER_KEYPAIR
 * signs AND pays for settle; the authority is kept for create / set_phoenix_market / admin_settle.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { loadConfig, resolveSettler } from "../src/config";

const PROGRAM_ID = new PublicKey("9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6");
const asEnv = (kp: Keypair) => JSON.stringify(Array.from(kp.secretKey));
// DLV-119 L-5: localnet needs a loopback RPC.
const base = (cluster: string) => ({ SOLANA_CLUSTER: cluster, SOLANA_RPC_URL: cluster === "localnet" ? "http://127.0.0.1:8899" : "http://x" }) as any;

describe("M3 settler key: config", () => {
  it("SETTLER_KEYPAIR is read (raw, never logged)", () => {
    const s = Keypair.generate();
    expect(loadConfig({ ...base("devnet"), SETTLER_KEYPAIR: asEnv(s) }).settlerKeypairRaw).to.equal(asEnv(s));
    expect(loadConfig(base("devnet")).settlerKeypairRaw).to.equal("");
  });

  it("resolveSettler: a separate key is used as-is", () => {
    const a = Keypair.generate();
    const s = Keypair.generate();
    const r = resolveSettler(loadConfig({ ...base("devnet"), SETTLER_KEYPAIR: asEnv(s) }), a);
    expect(r.keypair.publicKey.toBase58()).to.equal(s.publicKey.toBase58());
    expect(r.separate).to.equal(true);
  });

  it("resolveSettler: SETTLER_KEYPAIR equal to the authority is refused (defeats the split)", () => {
    const a = Keypair.generate();
    expect(() => resolveSettler(loadConfig({ ...base("devnet"), SETTLER_KEYPAIR: asEnv(a) }), a)).to.throw(/must differ/);
  });

  it("resolveSettler: unset on mainnet-beta → refuse to start", () => {
    expect(() => resolveSettler(loadConfig(base("mainnet-beta")), Keypair.generate())).to.throw(/SETTLER_KEYPAIR required/);
  });

  it("resolveSettler: unset on devnet/localnet → authority fallback, flagged (logged as a warning)", () => {
    const a = Keypair.generate();
    for (const c of ["devnet", "localnet"]) {
      const r = resolveSettler(loadConfig(base(c)), a);
      expect(r.separate).to.equal(false);
      expect(r.keypair.publicKey.toBase58()).to.equal(a.publicKey.toBase58());
    }
  });
});

function recordingProgram(tag: string, calls: string[], opts: { settleThrows?: boolean; markets?: any[] } = {}) {
  const chain = (name: string) => {
    const c: any = {
      accounts: (a: any) => {
        calls.push(`${tag}.${name}.accounts:${Object.entries(a).filter(([k]) => k === "settler" || k === "authority").map(([k, v]) => `${k}=${(v as PublicKey).toBase58()}`).join(",")}`);
        return c;
      },
      accountsPartial: (a: any) => c.accounts(a),
      signers: (s: Keypair[]) => {
        calls.push(`${tag}.${name}.signers:${s.map((k) => k.publicKey.toBase58()).join(",")}`);
        return c;
      },
      rpc: async () => {
        if (name === "settle" && opts.settleThrows) throw new Error("settle not possible");
        calls.push(`${tag}.${name}.rpc`);
        return `${tag}-sig`;
      },
    };
    return c;
  };
  return {
    programId: PROGRAM_ID,
    provider: { connection: {} },
    account: {
      strikeMarket: { all: async () => opts.markets ?? [] },
      config: { fetch: async () => ({ settleMaxStalenessSlots: { toString: () => "150" }, settleMaxConfRatioBps: 200 }) },
    },
    methods: { settle: () => chain("settle"), adminSettle: () => chain("adminSettle") },
  } as any;
}

const EXPIRY = 1_791_400_000;
const openMarket = (market: PublicKey) => ({
  publicKey: market,
  account: {
    status: 0,
    expiryTs: { toString: () => String(EXPIRY) },
    equitySymbol: Buffer.from("AAPL    "),
    pythPriceFeed: Keypair.generate().publicKey,
    pythFeedId: Array.from(Buffer.alloc(32, 7)),
  },
});

describe("M3 settler key: calendar settle pass", () => {
  it("localnet: settle is signed + paid via the settler program; the authority program never sends settle", async () => {
    const { runSettlePass, createCalendarState } = await import("../src/modes/calendar");
    const a = Keypair.generate();
    const s = Keypair.generate();
    const calls: string[] = [];
    const markets = [openMarket(Keypair.generate().publicKey)];
    const authorityProgram = recordingProgram("authority", calls, { markets });
    const settlerProgram = recordingProgram("settler", calls, { markets });
    const cfg = { ...loadConfig(base("localnet")), settleHourEt: 0 };
    await runSettlePass({
      cfg,
      program: authorityProgram,
      authority: a,
      settler: { keypair: s, program: settlerProgram },
      state: createCalendarState(),
      now: new Date((EXPIRY + 120) * 1000),
    });
    expect(calls).to.include(`settler.settle.accounts:settler=${s.publicKey.toBase58()}`);
    expect(calls).to.include(`settler.settle.signers:${s.publicKey.toBase58()}`);
    expect(calls).to.include("settler.settle.rpc");
    expect(calls.filter((c) => c.startsWith("authority.settle"))).to.deep.equal([]);
    expect(calls.join("\n")).to.not.contain(`settler=${a.publicKey.toBase58()}`);
  });

  it("devnet pull path: the pull-settle deps are built for the settler (not the authority)", async () => {
    const { runSettlePass, createCalendarState } = await import("../src/modes/calendar");
    const a = Keypair.generate();
    const s = Keypair.generate();
    const calls: string[] = [];
    const markets = [openMarket(Keypair.generate().publicKey)];
    let depsSettler: string | null = null;
    let depsProgram: string | null = null;
    const settlerProgram = recordingProgram("settler", calls, { markets });
    await runSettlePass({
      cfg: { ...loadConfig(base("devnet")), settleHourEt: 0 },
      program: recordingProgram("authority", calls, { markets }),
      authority: a,
      settler: { keypair: s, program: settlerProgram },
      state: createCalendarState(),
      now: new Date((EXPIRY + 120) * 1000),
      pullDeps: (_m, settler, program) => {
        depsSettler = settler.publicKey.toBase58();
        depsProgram = program === settlerProgram ? "settler" : "other";
        return {
          getAccountInfo: async () => null,
          fetchUpdate: async () => {
            throw new Error("no hermes in test");
          },
          settleWithAccount: async () => "x",
          postAndSettle: async () => ["s"],
        };
      },
    });
    expect(depsSettler).to.equal(s.publicKey.toBase58());
    expect(depsProgram).to.equal("settler");
  });

  it("admin_settle fallback stays authority-only", async () => {
    const { runSettlePass, createCalendarState } = await import("../src/modes/calendar");
    const a = Keypair.generate();
    const s = Keypair.generate();
    const calls: string[] = [];
    const markets = [openMarket(Keypair.generate().publicKey)];
    const cfg = {
      ...loadConfig({ ...base("localnet"), ADMIN_SETTLE_PRICE_E6: "180000000", ADMIN_SETTLE_OUTCOME_YES: "true", ADMIN_SETTLE_AFTER_RETRIES: "1" }),
      settleHourEt: 0,
    };
    await runSettlePass({
      cfg,
      program: recordingProgram("authority", calls, { markets }),
      authority: a,
      settler: { keypair: s, program: recordingProgram("settler", calls, { markets, settleThrows: true }) },
      state: createCalendarState(),
      now: new Date((EXPIRY + 120) * 1000),
    });
    expect(calls).to.include(`authority.adminSettle.accounts:authority=${a.publicKey.toBase58()}`);
    expect(calls).to.include(`authority.adminSettle.signers:${a.publicKey.toBase58()}`);
    expect(calls.filter((c) => c.startsWith("settler.adminSettle"))).to.deep.equal([]);
  });
});

describe("M3 settler key: entry points wire it", () => {
  const SRC = path.resolve(__dirname, "../src");
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
  it("no settle path uses the authority as settler", () => {
    for (const f of ["modes/calendar.ts", "modes/sim.ts"]) {
      expect(read(f), f).to.not.match(/settler:\s*opts\.authority\b/);
    }
  });
  it("worker + sim-lifecycle resolve the settler and give it its own program/provider", () => {
    for (const f of ["worker.ts", "sim-lifecycle.ts"]) {
      const src = read(f);
      expect(src, f).to.match(/resolveSettler\(cfg, authority\)/);
      expect(src, f).to.match(/createProgram\(cfg, settler\.keypair\)/);
    }
  });
});
