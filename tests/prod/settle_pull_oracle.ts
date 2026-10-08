/**
 * DLV-078 / D-025 — PROD settle reads Pyth pull-oracle `PriceUpdateV2` accounts.
 *
 * Runs the **production** `.so` (built WITHOUT `localnet-test`) in LiteSVM, so the
 * real decoder is exercised (the localnet suite only ever sees the mock layout).
 * Config / StrikeMarket / price accounts are injected directly; the clock is set per case.
 *
 * Build the prod artifact first:  yarn build:prod-so   (→ target/prod/meridian.so)
 * Override with MERIDIAN_PROD_SO=/path/to/meridian.so (CI uses target/deploy/meridian.so
 * from the prod-build job). If the artifact is missing the suite is skipped loudly.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, Connection, TransactionInstruction } from "@solana/web3.js";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import {
  address,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  AccountRole,
  KeyPairSigner,
} from "@solana/kit";

const ROOT = path.resolve(__dirname, "../..");
const PROD_SO = process.env.MERIDIAN_PROD_SO ?? path.join(ROOT, "target/prod/meridian.so");
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/meridian.prod.json"), "utf8")) as Idl & {
  address: string;
};
const PROGRAM_ID = new PublicKey(IDL.address);
export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const LEGACY_PYTH_ORACLE = new PublicKey("FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH");
const PRICE_UPDATE_V2_DISC = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

/** Equity.US.AAPL/USD (D-019). */
const AAPL_FEED_ID = Buffer.from("49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", "hex");
const AAPL_SYMBOL = Buffer.from("AAPL    ");
const STALENESS_SLOTS = 150; // D-005 → 60 s publish window (150 × 0.4 s)
const WINDOW_SECS = 60;
const CONF_BPS = 500; // D-005
const EXPIRY = 1_791_489_600; // 2026-10-08 16:00 ET
const STRIKE_E6 = 230_000_000; // $230

/** Real account bytes (getAccountInfo, 2026-10-08 02:4x UTC). */
// devnet push feed shard-1 AAPL D9uk39pq… — Full, publish 2026-10-08T02:05:01Z, prev = publish−1 s.
const REAL_DEVNET_AAPL_SHARD1 =
  "IvEjY51+9M20lIZyMNU/Ew6sDypIEyPeOYmooRWTOJq2X67JeylJMQFJ9rZcsd5rEOr3XnwDygKcMG0DV+kbUxGxdQhKWtVWiOgyAQIAAAAAxAkAAAAAAAD7////TfrGagAAAABM+sZqAAAAAOQzAQIAAAAABAAAAAAAAAD9iFEeAAAAAAA=";
// mainnet push feed shard-0 AAPL DJ2FyTgU… — Full, publish 2026-08-14T20:00:19Z, prev == publish (2nd aggregate in that second).
const REAL_MAINNET_AAPL_SHARD0 =
  "IvEjY51+9M22qIobWbfIasZFzYU4kLAmRMXwVLcgFl9Eo5UYbkGDfgFJ9rZcsd5rEOr3XnwDygKcMG0DV+kbUxGxdQhKWtVWiADM0gEAAAAA0AcAAAAAAAD7////03N/agAAAADTc39qAAAAAKaF0gEAAAAAlzYAAAAAAAAcHDcaAAAAAAA=";

export interface PriceUpdateV2Fields {
  writeAuthority?: PublicKey;
  /** undefined → Full; number → Partial { num_signatures }. */
  partialSignatures?: number;
  feedId?: Buffer;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  prevPublishTime: number;
  postedSlot?: bigint;
}

/** Borsh layout of pyth-solana-receiver-sdk `PriceUpdateV2` (allocated 134 B). */
export function encodePriceUpdateV2(f: PriceUpdateV2Fields): Buffer {
  const buf = Buffer.alloc(134);
  let o = 0;
  PRICE_UPDATE_V2_DISC.copy(buf, o); o += 8;
  (f.writeAuthority ?? Keypair.generate().publicKey).toBuffer().copy(buf, o); o += 32;
  if (f.partialSignatures === undefined) { buf.writeUInt8(1, o); o += 1; }
  else { buf.writeUInt8(0, o); buf.writeUInt8(f.partialSignatures, o + 1); o += 2; }
  (f.feedId ?? AAPL_FEED_ID).copy(buf, o); o += 32;
  buf.writeBigInt64LE(f.price, o); o += 8;
  buf.writeBigUInt64LE(f.conf, o); o += 8;
  buf.writeInt32LE(f.expo, o); o += 4;
  buf.writeBigInt64LE(BigInt(f.publishTime), o); o += 8;
  buf.writeBigInt64LE(BigInt(f.prevPublishTime), o); o += 8;
  buf.writeBigInt64LE(f.price, o); o += 8; // ema_price
  buf.writeBigUInt64LE(f.conf, o); o += 8; // ema_conf
  buf.writeBigUInt64LE(f.postedSlot ?? 1000n, o); o += 8;
  return buf;
}

const haveSo = fs.existsSync(PROD_SO);

(haveSo ? describe : describe.skip)(
  `DLV-078 prod settle — Pyth pull oracle PriceUpdateV2 (${path.relative(ROOT, PROD_SO)})`,
  () => {
    let svm: LiteSVM;
    let payer: KeyPairSigner;
    let program: Program;
    let configPda: PublicKey;
    let configBump: number;
    let market: PublicKey;
    let registeredFeed: PublicKey;

    before(() => {
      if (!haveSo) return;
      const provider = new anchor.AnchorProvider(
        new Connection("http://127.0.0.1:1"),
        new anchor.Wallet(Keypair.generate()),
        {}
      );
      program = new Program(IDL, provider);
      [configPda, configBump] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
    });

    async function boot(opts: { feedId?: Buffer; nowTs?: number } = {}) {
      svm = new LiteSVM();
      svm.addProgramFromFile(address(PROGRAM_ID.toBase58()), PROD_SO);
      payer = await generateKeyPairSigner();
      svm.airdrop(payer.address, lamports(10n * BigInt(LAMPORTS_PER_SOL)));
      const payerPk = new PublicKey(payer.address);
      const configData = await program.coder.accounts.encode("config", {
        authority: payerPk,
        collateralMint: Keypair.generate().publicKey,
        collateralDecimals: 6,
        treasury: payerPk,
        mintFeeBps: 0,
        redeemFeeBps: 0,
        paused: false,
        settleMaxStalenessSlots: new BN(STALENESS_SLOTS),
        settleMaxConfRatioBps: CONF_BPS,
        adminSettleDelaySecs: new BN(1800),
        nextMarketId: new BN(2),
        bump: configBump,
        lastConfigUpdateTs: new BN(0),
        reserved: Array(40).fill(0),
      });
      put(configPda, { executable: false, owner: PROGRAM_ID, lamports: LAMPORTS_PER_SOL, data: configData });
      market = Keypair.generate().publicKey;
      registeredFeed = Keypair.generate().publicKey;
      const z = PublicKey.default;
      const marketData = await program.coder.accounts.encode("strikeMarket", {
        config: configPda,
        marketId: new BN(1),
        equitySymbol: Array.from(AAPL_SYMBOL),
        pythPriceFeed: registeredFeed,
        pythFeedId: Array.from(opts.feedId ?? AAPL_FEED_ID),
        strikePriceE6: new BN(STRIKE_E6),
        expiryTs: new BN(EXPIRY),
        yesMint: Keypair.generate().publicKey,
        noMint: Keypair.generate().publicKey,
        collateralVault: Keypair.generate().publicKey,
        phoenixMarket: z,
        phoenixBaseMint: z,
        phoenixQuoteMint: z,
        status: 0,
        pairsMinted: new BN(0),
        pairsRedeemed: new BN(0),
        settlementPriceE6: new BN(0),
        settledAtTs: new BN(0),
        settledSlot: new BN(0),
        bump: 255,
        vaultBump: 255,
        tradingOpen: true,
        simArmed: false,
        reserved: Array(62).fill(0),
      });
      put(market, { executable: false, owner: PROGRAM_ID, lamports: LAMPORTS_PER_SOL, data: marketData });
      setNow(opts.nowTs ?? EXPIRY + 600);
    }

    function put(addr: PublicKey, a: { owner: PublicKey; lamports: number; data: Buffer; executable: boolean }) {
      svm.setAccount({
        address: address(addr.toBase58()),
        programAddress: address(a.owner.toBase58()),
        lamports: lamports(BigInt(a.lamports)),
        data: new Uint8Array(a.data),
        executable: a.executable,
        space: BigInt(a.data.length),
      });
    }

    function setNow(ts: number) {
      const c = svm.getClock();
      c.unixTimestamp = BigInt(ts);
      c.slot = 5_000n;
      svm.setClock(c);
    }

    function putAccount(data: Buffer, owner: PublicKey = PYTH_RECEIVER, at?: PublicKey): PublicKey {
      const addr = at ?? Keypair.generate().publicKey;
      put(addr, { executable: false, owner, lamports: LAMPORTS_PER_SOL, data });
      return addr;
    }

    function update(over: Partial<PriceUpdateV2Fields> = {}): Buffer {
      return encodePriceUpdateV2({
        price: 23_512_345_000n, // $235.12345 @ expo -8
        conf: 5_000_000n, // $0.05
        expo: -8,
        publishTime: EXPIRY + 1,
        prevPublishTime: EXPIRY - 1,
        ...over,
      });
    }

    async function settle(feed: PublicKey, as?: KeyPairSigner): Promise<{ ok: boolean; logs: string[] }> {
      // `as` = a different settler that signs AND pays (M3: never the config authority).
      const signer = as ?? payer;
      const ix: TransactionInstruction = await program.methods
        .settle()
        .accountsPartial({
          settler: new PublicKey(signer.address),
          config: configPda,
          strikeMarket: market,
          pythPriceFeed: feed,
          simClock: null,
        } as any)
        .instruction();
      const kitIx = {
        programAddress: address(ix.programId.toBase58()),
        accounts: ix.keys.map((k) => ({
          address: address(k.pubkey.toBase58()),
          role: k.isSigner
            ? k.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
            : k.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
          ...(k.isSigner && k.pubkey.toBase58() === signer.address ? { signer } : {}),
        })),
        data: new Uint8Array(ix.data),
      };
      const msg = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
        (m) => appendTransactionMessageInstruction(kitIx as any, m)
      );
      const tx = await signTransactionMessageWithSigners(msg);
      const res = svm.sendTransaction(tx as any);
      svm.expireBlockhash();
      if (res instanceof FailedTransactionMetadata) return { ok: false, logs: res.meta().logs() };
      return { ok: true, logs: res.logs() };
    }

    async function marketState() {
      const acct = svm.getAccount(address(market.toBase58()));
      if (!acct.exists) throw new Error("market missing");
      return program.coder.accounts.decode("strikeMarket", Buffer.from(acct.data)) as any;
    }

    async function expectErr(feed: PublicKey, code: string) {
      const r = await settle(feed);
      expect(r.ok, `expected ${code}, got success`).to.equal(false);
      expect(r.logs.join("\n")).to.contain(`Error Code: ${code}`);
      expect((await marketState()).status).to.equal(0);
    }

    it("PULL-M3: a non-authority settler key signs and pays for settle (permissionless; no authority signature)", async () => {
      await boot();
      const settler = await generateKeyPairSigner();
      svm.airdrop(settler.address, lamports(BigInt(LAMPORTS_PER_SOL / 100))); // low balance: 0.01 SOL
      const cfg = program.coder.accounts.decode(
        "config",
        Buffer.from((svm.getAccount(address(configPda.toBase58())) as any).data),
      ) as any;
      expect(cfg.authority.toBase58()).to.not.equal(settler.address);
      const r = await settle(putAccount(update()), settler);
      expect(r.ok, r.logs.join("\n")).to.equal(true);
      expect((await marketState()).status).to.equal(2); // SettledYes
    });

    it("PULL-01: Full PriceUpdateV2, matching feed id, first update after expiry → SettledYes at Pyth price (e6)", async () => {
      await boot();
      const r = await settle(putAccount(update()));
      expect(r.ok, r.logs.join("\n")).to.equal(true);
      const m = await marketState();
      expect(m.status).to.equal(2); // SettledYes
      expect(m.settlementPriceE6.toString()).to.equal("235123450");
    });

    it("PULL-02a: price == strike → Yes (D-005 ≥)", async () => {
      await boot();
      const r = await settle(putAccount(update({ price: 23_000_000_000n })));
      expect(r.ok, r.logs.join("\n")).to.equal(true);
      expect((await marketState()).status).to.equal(2);
    });

    it("PULL-02b: price < strike → SettledNo", async () => {
      await boot();
      const r = await settle(putAccount(update({ price: 22_999_999_999n })));
      expect(r.ok, r.logs.join("\n")).to.equal(true);
      const m = await marketState();
      expect(m.status).to.equal(3);
      expect(m.settlementPriceE6.toString()).to.equal("229999999");
    });

    it("PULL-03: freshly posted update at any address (≠ registered sponsored feed) is accepted", async () => {
      await boot();
      const posted = putAccount(update());
      expect(posted.equals(registeredFeed)).to.equal(false);
      expect((await settle(posted)).ok).to.equal(true);
    });

    it("PULL-03b: registered sponsored feed account also works when its update is in window", async () => {
      await boot();
      putAccount(update(), PYTH_RECEIVER, registeredFeed);
      expect((await settle(registeredFeed)).ok).to.equal(true);
    });

    it("PULL-04: account not owned by the Pyth receiver → InvalidPythAccount", async () => {
      await boot();
      await expectErr(putAccount(update(), Keypair.generate().publicKey), "InvalidPythAccount");
    });

    it("PULL-05a: feed id ≠ market.pyth_feed_id → InvalidPythAccount", async () => {
      await boot();
      await expectErr(putAccount(update({ feedId: Buffer.alloc(32, 7) })), "InvalidPythAccount");
    });

    it("PULL-05b: market with zero feed id cannot permissionless-settle → InvalidPythAccount", async () => {
      await boot({ feedId: Buffer.alloc(32, 0) });
      await expectErr(putAccount(update({ feedId: Buffer.alloc(32, 0) })), "InvalidPythAccount");
    });

    it("PULL-06: Partial verification level → InvalidPythAccount", async () => {
      await boot();
      await expectErr(putAccount(update({ partialSignatures: 5 })), "InvalidPythAccount");
    });

    it("PULL-07a: legacy push-oracle Price layout (magic 0xa1b2c3d4) → InvalidPythAccount", async () => {
      await boot();
      const legacy = Buffer.alloc(3312);
      legacy.writeUInt32LE(0xa1b2c3d4, 0);
      legacy.writeInt32LE(-8, 20);
      legacy.writeBigInt64LE(23_512_345_000n, 208);
      await expectErr(putAccount(legacy, LEGACY_PYTH_ORACLE), "InvalidPythAccount");
      await expectErr(putAccount(legacy, PYTH_RECEIVER), "InvalidPythAccount");
    });

    it("PULL-07b: Meridian mock layout owned by receiver → InvalidPythAccount (bad discriminator)", async () => {
      await boot();
      const mock = Buffer.alloc(134);
      mock.writeUInt32LE(0x5459504d, 0);
      await expectErr(putAccount(mock), "InvalidPythAccount");
    });

    it("PULL-07c: truncated PriceUpdateV2 → InvalidPythAccount", async () => {
      await boot();
      await expectErr(putAccount(update().subarray(0, 100)), "InvalidPythAccount");
    });

    it("PULL-08: publish_time before expiry → PythPriceNotAtExpiry", async () => {
      await boot();
      await expectErr(putAccount(update({ publishTime: EXPIRY - 1, prevPublishTime: EXPIRY - 2 })), "PythPriceNotAtExpiry");
    });

    it("PULL-09: not the first update at/after expiry (prev_publish_time ≥ expiry) → PythPriceNotAtExpiry", async () => {
      await boot();
      await expectErr(putAccount(update({ publishTime: EXPIRY + 5, prevPublishTime: EXPIRY + 4 })), "PythPriceNotAtExpiry");
      await expectErr(putAccount(update({ publishTime: EXPIRY, prevPublishTime: EXPIRY })), "PythPriceNotAtExpiry");
    });

    it("PULL-10a: publish_time = expiry + 60 s (150 slots × 0.4 s) → accepted", async () => {
      await boot();
      const r = await settle(putAccount(update({ publishTime: EXPIRY + WINDOW_SECS, prevPublishTime: EXPIRY - 30 })));
      expect(r.ok, r.logs.join("\n")).to.equal(true);
    });

    it("PULL-10b: publish_time > expiry + 60 s → StalePythPrice", async () => {
      await boot();
      await expectErr(putAccount(update({ publishTime: EXPIRY + WINDOW_SECS + 1, prevPublishTime: EXPIRY - 30 })), "StalePythPrice");
    });

    it("PULL-11: confidence wider than 500 bps → PythConfidenceTooWide", async () => {
      await boot();
      await expectErr(putAccount(update({ conf: 1_200_000_000n })), "PythConfidenceTooWide"); // $12 on $235 ≈ 510 bps
    });

    it("PULL-12: before expiry → ExpiryNotReached", async () => {
      await boot({ nowTs: EXPIRY - 10 });
      await expectErr(putAccount(update()), "ExpiryNotReached");
    });

    it("PULL-13a: real devnet shard-1 AAPL PriceUpdateV2 bytes decode + settle (expiry = its publish_time)", async () => {
      // publish 2026-10-08T02:05:01Z (1791425101), price 33633000 @ -5 = $336.33 ≥ $230 → Yes.
      const data = Buffer.from(REAL_DEVNET_AAPL_SHARD1, "base64");
      expect(data.length).to.equal(134);
      await boot();
      // re-point market expiry at the real publish time
      const m = await marketState();
      m.expiryTs = new BN(1_791_425_101);
      const enc = await program.coder.accounts.encode("strikeMarket", m);
      put(market, { executable: false, owner: PROGRAM_ID, lamports: LAMPORTS_PER_SOL, data: enc });
      setNow(1_791_425_101 + 3600);
      const r = await settle(putAccount(data));
      expect(r.ok, r.logs.join("\n")).to.equal(true);
      const after = await marketState();
      expect(after.status).to.equal(2);
      expect(after.settlementPriceE6.toString()).to.equal("336330000");
    });

    it("PULL-13b: real mainnet shard-0 bytes where prev_publish_time == publish_time → PythPriceNotAtExpiry", async () => {
      const data = Buffer.from(REAL_MAINNET_AAPL_SHARD0, "base64");
      await boot();
      const m = await marketState();
      m.expiryTs = new BN(1_786_737_619); // 2026-08-14T20:00:19Z
      const enc = await program.coder.accounts.encode("strikeMarket", m);
      put(market, { executable: false, owner: PROGRAM_ID, lamports: LAMPORTS_PER_SOL, data: enc });
      setNow(1_786_737_619 + 60);
      await expectErr(putAccount(data), "PythPriceNotAtExpiry");
    });

    it("PULL-14: already settled → MarketNotOpen", async () => {
      await boot();
      const feed = putAccount(update());
      expect((await settle(feed)).ok).to.equal(true);
      const r = await settle(putAccount(update({ price: 1_000_000_000n })));
      expect(r.ok).to.equal(false);
      expect(r.logs.join("\n")).to.contain("Error Code: MarketNotOpen");
    });
  }
);

if (!haveSo) {
  describe("DLV-078 prod settle (pull oracle)", () => {
    it(`SKIPPED — prod .so missing at ${PROD_SO}; run \`yarn build:prod-so\``, function () {
      this.skip();
    });
  });
}
