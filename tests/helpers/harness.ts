/**
 * Bankrun + Anchor harness for Meridian P0 suite (D-016).
 * Phoenix: pubkey wiring only. Pyth: MockPythPrice account fixtures.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError, Idl } from "@coral-xyz/anchor";
import { BankrunProvider, startAnchor } from "anchor-bankrun";
import { Clock, ProgramTestContext } from "solana-bankrun";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  MintLayout,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from "@solana/spl-token";
import {
  MERIDIAN_PROGRAM_ID,
  DEFAULT_STRIKE_E6,
  EQUITY_AAPL,
  DEFAULT_STALENESS_SLOTS,
  DEFAULT_CONF_RATIO_BPS,
  DEFAULT_ADMIN_SETTLE_DELAY_SECS,
  DEFAULT_MINT_FEE_BPS,
  DEFAULT_REDEEM_FEE_BPS,
  ONE,
  PYTH_FEED_ID_PLACEHOLDER,
  PHOENIX_MARKET_PLACEHOLDER,
  MarketStatus,
} from "./fixtures";

export class TddRedError extends Error {
  readonly code = "TDD_RED";
  constructor(caseId: string, detail: string) {
    super(
      `[TDD_RED ${caseId}] ${detail} — Engineers: implement only enough program code to green this case (D-016). See docs/TEST_MATRIX.md.`
    );
    this.name = "TddRedError";
  }
}

export const EXPECTED_INSTRUCTIONS = [
  "initialize_config",
  "update_config",
  "pause",
  "unpause",
  "create_strike_market",
  "set_phoenix_market",
  "mint",
  "settle",
  "admin_settle",
  "redeem",
  "burn_losing",
] as const;

export type IxName = (typeof EXPECTED_INSTRUCTIONS)[number];

const MOCK_PYTH_MAGIC = 0x5459504d;

function findRepoRoot(): string {
  return path.resolve(__dirname, "../..");
}

export function loadMeridianIdl(): Idl & { address: string } {
  const root = findRepoRoot();
  const candidates = [
    path.join(root, "target/idl/meridian.json"),
    path.join(root, "idl/meridian.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }
  }
  throw new TddRedError("IDL", "meridian IDL not found");
}

export function assertIdlHasInstructions(caseId: string = "IDL") {
  const idl = loadMeridianIdl();
  const names = new Set(idl.instructions.map((i) => i.name));
  for (const ix of EXPECTED_INSTRUCTIONS) {
    expect(names.has(ix), `${caseId}: IDL missing instruction '${ix}'`).to.equal(true);
  }
  expect(idl.address).to.equal(MERIDIAN_PROGRAM_ID.toBase58());
}

/** units.md §4.2 / §8 — mirrors programs/meridian/src/utils/pyth.rs */
export function pythPriceToE6(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new Error("InvalidPythPrice");
  const shift = expo + 6;
  let e6: bigint;
  if (shift >= 0) e6 = price * 10n ** BigInt(shift);
  else e6 = price / 10n ** BigInt(-shift);
  if (e6 === 0n) throw new Error("InvalidPythPrice");
  return e6;
}

export function packMockPyth(args: {
  price: bigint;
  conf: bigint;
  expo: number;
  publishSlot: bigint;
  feedId?: Buffer;
}): Buffer {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(MOCK_PYTH_MAGIC, 0);
  buf.writeBigInt64LE(args.price, 4);
  buf.writeBigUInt64LE(args.conf, 12);
  buf.writeInt32LE(args.expo, 20);
  buf.writeBigUInt64LE(args.publishSlot, 24);
  (args.feedId ?? Buffer.from(PYTH_FEED_ID_PLACEHOLDER)).copy(buf, 32);
  return buf;
}

export function requireProgram(caseId: string): never {
  throw new TddRedError(
    caseId,
    "use TestCtx.fromBankrun() — legacy requireProgram path retired"
  );
}

export async function invokeIx(caseId: string, _ix: IxName, _args?: unknown): Promise<never> {
  return requireProgram(caseId);
}

export function isAnchorErrorCode(e: unknown, name: string): boolean {
  if (e instanceof AnchorError) return e.error.errorCode.code === name;
  const msg = String((e as any)?.toString?.() ?? (e as any)?.message ?? e);
  return msg.includes(name);
}

export async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
    expect.fail(`expected error ${code}`);
  } catch (e) {
    expect(isAnchorErrorCode(e, code), `expected ${code}, got: ${e}`).to.equal(true);
  }
}

export type MeridianProgram = Program;

export class TestCtx {
  context!: ProgramTestContext;
  provider!: BankrunProvider;
  program!: any;
  authority!: Keypair;
  user!: Keypair;
  collateralMint!: PublicKey;
  treasury!: PublicKey;
  configPda!: PublicKey;
  userCollateral!: PublicKey;
  userYes!: PublicKey;
  userNo!: PublicKey;
  market!: PublicKey;
  yesMint!: PublicKey;
  noMint!: PublicKey;
  vault!: PublicKey;
  vaultAuthority!: PublicKey;
  pythFeed!: PublicKey;
  equity = Buffer.from(EQUITY_AAPL);
  strike = new BN(DEFAULT_STRIKE_E6.toString());
  expiryTs!: BN;
  feedId = Buffer.from(PYTH_FEED_ID_PLACEHOLDER);
  clockUnix = 1_700_000_000;
  clockSlot = 1000n;

  static async boot(): Promise<TestCtx> {
    const ctx = new TestCtx();
    // Load program from workspace (Anchor.toml programs)
    const root = path.resolve(__dirname, "../..");
    process.chdir(root);
    ctx.context = await startAnchor(
      ".",
      [{ name: "meridian", programId: MERIDIAN_PROGRAM_ID }],
      []
    );
    ctx.provider = new BankrunProvider(ctx.context);
    anchor.setProvider(ctx.provider);
    const idl = loadMeridianIdl();
    ctx.program = new Program(idl, ctx.provider);
    ctx.authority = ctx.context.payer;
    ctx.user = Keypair.generate();
    await ctx.setClock(ctx.clockUnix, ctx.clockSlot);
    return ctx;
  }

  async setClock(unixTimestamp: number, slot: bigint) {
    this.clockUnix = unixTimestamp;
    this.clockSlot = slot;
    const clock = new Clock(
      slot,
      0n,
      0n,
      0n,
      BigInt(unixTimestamp)
    );
    this.context.setClock(clock);
  }

  async warpUnix(unixTimestamp: number) {
    await this.setClock(unixTimestamp, this.clockSlot + 10n);
  }

  async fund(pk: PublicKey, lamports = 10n * 1_000_000_000n) {
    this.context.setAccount(pk, {
      lamports: Number(lamports),
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
  }

  async setupProtocol(opts?: {
    adminDelay?: number;
    mintFeeBps?: number;
    redeemFeeBps?: number;
  }) {
    await this.fund(this.user.publicKey);

    // Create mint account manually in bankrun
    const mintKp = Keypair.generate();
    this.collateralMint = mintKp.publicKey;
    const mintRent = 1_000_000_000;
    const mintData = Buffer.alloc(MINT_SIZE);
    // We'll initialize via tx
    this.context.setAccount(mintKp.publicKey, {
      lamports: mintRent,
      data: Buffer.alloc(MINT_SIZE),
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });

    const ixInit = createInitializeMint2Instruction(
      mintKp.publicKey,
      6,
      this.authority.publicKey,
      null
    );
    await this.sendIx([ixInit]);

    this.treasury = getAssociatedTokenAddressSync(
      this.collateralMint,
      this.authority.publicKey
    );
    await this.sendIx([
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        this.treasury,
        this.authority.publicKey,
        this.collateralMint
      ),
    ]);

    [this.configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.program.programId
    );

    await this.program.methods
      .initializeConfig({
        mintFeeBps: opts?.mintFeeBps ?? DEFAULT_MINT_FEE_BPS,
        redeemFeeBps: opts?.redeemFeeBps ?? DEFAULT_REDEEM_FEE_BPS,
        settleMaxStalenessSlots: new BN(DEFAULT_STALENESS_SLOTS),
        settleMaxConfRatioBps: DEFAULT_CONF_RATIO_BPS,
        adminSettleDelaySecs: new BN(
          opts?.adminDelay ?? DEFAULT_ADMIN_SETTLE_DELAY_SECS
        ),
      })
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
        collateralMint: this.collateralMint,
        treasury: this.treasury,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authority])
      .rpc();

    this.userCollateral = getAssociatedTokenAddressSync(
      this.collateralMint,
      this.user.publicKey
    );
    await this.sendIx([
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        this.userCollateral,
        this.user.publicKey,
        this.collateralMint
      ),
    ]);
    await this.sendIx([
      createMintToInstruction(
        this.collateralMint,
        this.userCollateral,
        this.authority.publicKey,
        BigInt(1_000_000_000_000)
      ),
    ]);
  }

  async sendIx(ixs: TransactionInstruction[], signers: Keypair[] = []) {
    const tx = new Transaction();
    const [recent] = await Promise.all([this.context.banksClient.getLatestBlockhash()]);
    tx.recentBlockhash = recent?.[0] ?? this.context.lastBlockhash;
    tx.feePayer = this.authority.publicKey;
    tx.add(...ixs);
    tx.sign(this.authority, ...signers);
    await this.context.banksClient.processTransaction(tx);
  }

  setMockPyth(opts: {
    price: bigint;
    conf?: bigint;
    expo?: number;
    publishSlot?: bigint;
    feedId?: Buffer;
    pubkey?: PublicKey;
  }) {
    const kp = Keypair.generate();
    this.pythFeed = opts.pubkey ?? kp.publicKey;
    const data = packMockPyth({
      price: opts.price,
      conf: opts.conf ?? 1_000n,
      expo: opts.expo ?? -8,
      publishSlot: opts.publishSlot ?? this.clockSlot - 1n,
      feedId: opts.feedId ?? this.feedId,
    });
    this.context.setAccount(this.pythFeed, {
      lamports: 1_000_000,
      data,
      owner: this.program.programId,
      executable: false,
    });
    return this.pythFeed;
  }

  async createMarket(opts?: {
    expiryTs?: number;
    strike?: BN;
    phoenix?: PublicKey;
    pythPrice?: bigint;
    pythConf?: bigint;
    pythSlot?: bigint;
    wrongFeed?: boolean;
  }) {
    this.expiryTs = new BN(opts?.expiryTs ?? this.clockUnix + 86_400);
    this.strike = opts?.strike ?? this.strike;
    this.setMockPyth({
      price: opts?.pythPrice ?? 18_000_000_000n,
      conf: opts?.pythConf ?? 1_000n,
      publishSlot: opts?.pythSlot,
      feedId: opts?.wrongFeed ? Buffer.alloc(32, 0x99) : this.feedId,
    });

    const equity = this.equity;
    const expiryBuf = Buffer.alloc(8);
    expiryBuf.writeBigInt64LE(BigInt(this.expiryTs.toString()));
    const strikeBuf = Buffer.alloc(8);
    strikeBuf.writeBigUInt64LE(BigInt(this.strike.toString()));

    [this.market] = PublicKey.findProgramAddressSync(
      [Buffer.from("strike_market"), equity, expiryBuf, strikeBuf],
      this.program.programId
    );
    [this.yesMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("yes_mint"), this.market.toBuffer()],
      this.program.programId
    );
    [this.noMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("no_mint"), this.market.toBuffer()],
      this.program.programId
    );
    [this.vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), this.market.toBuffer()],
      this.program.programId
    );
    [this.vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("collateral_vault"), this.market.toBuffer()],
      this.program.programId
    );

    await this.program.methods
      .createStrikeMarket({
        equitySymbol: Array.from(equity),
        strikePriceE6: this.strike,
        expiryTs: this.expiryTs,
        pythFeedId: Array.from(this.feedId),
        phoenixMarket: opts?.phoenix ?? PHOENIX_MARKET_PLACEHOLDER,
      })
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        yesMint: this.yesMint,
        noMint: this.noMint,
        vaultAuthority: this.vaultAuthority,
        collateralVault: this.vault,
        collateralMint: this.collateralMint,
        pythPriceFeed: this.pythFeed,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([this.authority])
      .rpc();

    this.userYes = getAssociatedTokenAddressSync(this.yesMint, this.user.publicKey);
    this.userNo = getAssociatedTokenAddressSync(this.noMint, this.user.publicKey);
    await this.sendIx([
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        this.userYes,
        this.user.publicKey,
        this.yesMint
      ),
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        this.userNo,
        this.user.publicKey,
        this.noMint
      ),
    ]);
  }

  async pause() {
    await this.program.methods
      .pause()
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
      })
      .signers([this.authority])
      .rpc();
  }

  async unpause() {
    await this.program.methods
      .unpause()
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
      })
      .signers([this.authority])
      .rpc();
  }

  async mint(amount: BN, signer: Keypair = this.user) {
    const userCol = getAssociatedTokenAddressSync(this.collateralMint, signer.publicKey);
    const userYes = getAssociatedTokenAddressSync(this.yesMint, signer.publicKey);
    const userNo = getAssociatedTokenAddressSync(this.noMint, signer.publicKey);
    await this.program.methods
      .mint(amount)
      .accounts({
        user: signer.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        collateralVault: this.vault,
        vaultAuthority: this.vaultAuthority,
        userCollateralAta: userCol,
        userYesAta: userYes,
        userNoAta: userNo,
        yesMint: this.yesMint,
        noMint: this.noMint,
        treasury: this.treasury,
        collateralMint: this.collateralMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  }

  async settle(settler: Keypair = this.user) {
    await this.program.methods
      .settle()
      .accounts({
        settler: settler.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        pythPriceFeed: this.pythFeed,
      })
      .signers([settler])
      .rpc();
  }

  async adminSettle(priceE6: BN, outcomeYes: boolean, authority: Keypair = this.authority) {
    await this.program.methods
      .adminSettle(priceE6, outcomeYes)
      .accounts({
        authority: authority.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
      })
      .signers([authority])
      .rpc();
  }

  async redeem(amount: BN, winning: "yes" | "no", signer: Keypair = this.user) {
    const winningMint = winning === "yes" ? this.yesMint : this.noMint;
    const userWinning = getAssociatedTokenAddressSync(winningMint, signer.publicKey);
    const userCol = getAssociatedTokenAddressSync(this.collateralMint, signer.publicKey);
    await this.program.methods
      .redeem(amount)
      .accounts({
        user: signer.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        collateralVault: this.vault,
        vaultAuthority: this.vaultAuthority,
        userCollateralAta: userCol,
        userWinningAta: userWinning,
        winningMint,
        treasury: this.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  }

  async setPhoenix(pk: PublicKey = PHOENIX_MARKET_PLACEHOLDER) {
    await this.program.methods
      .setPhoenixMarket(pk)
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
      })
      .signers([this.authority])
      .rpc();
  }

  async tokenBal(ata: PublicKey): Promise<BN> {
    const acc = await this.context.banksClient.getAccount(ata);
    if (!acc) return new BN(0);
    const amount = AccountLayout.decode(Buffer.from(acc.data)).amount;
    return new BN(amount.toString());
  }

  async mintSupply(mint: PublicKey): Promise<BN> {
    const acc = await this.context.banksClient.getAccount(mint);
    if (!acc) return new BN(0);
    const supply = MintLayout.decode(Buffer.from(acc.data)).supply;
    return new BN(supply.toString());
  }

  async marketState() {
    return (this.program.account as any).strikeMarket.fetch(this.market);
  }

  async vaultAmount(): Promise<BN> {
    return this.tokenBal(this.vault);
  }

  async invariantCtx() {
    const m = await this.marketState();
    return {
      vaultAmount: await this.vaultAmount(),
      pairsMinted: m.pairsMinted as BN,
      pairsRedeemed: m.pairsRedeemed as BN,
      yesSupply: await this.mintSupply(this.yesMint),
      noSupply: await this.mintSupply(this.noMint),
      status: m.status as number,
    };
  }
}

export { MarketStatus, ONE, BN };
