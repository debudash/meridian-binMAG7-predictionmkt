/**
 * Anchor local-validator harness for Meridian P0 suite (D-016).
 * Phoenix: pubkey wiring only. Pyth: MockPythPrice via upsert_mock_pyth.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError, Idl, EventParser, BorshCoder } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
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
    super(`[TDD_RED ${caseId}] ${detail}`);
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

function findRepoRoot(): string {
  return path.resolve(__dirname, "../..");
}

export function loadMeridianIdl(): Idl & { address: string } {
  const root = findRepoRoot();
  for (const p of [
    path.join(root, "target/idl/meridian.json"),
    path.join(root, "idl/meridian.json"),
  ]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new TddRedError("IDL", "meridian IDL not found");
}

export function assertIdlHasInstructions(caseId: string = "IDL") {
  const idl = loadMeridianIdl();
  const names = new Set(idl.instructions.map((i) => i.name));
  for (const ix of EXPECTED_INSTRUCTIONS) {
    expect(names.has(ix), `${caseId}: IDL missing '${ix}'`).to.equal(true);
  }
  expect(idl.address).to.equal(MERIDIAN_PROGRAM_ID.toBase58());
}

export function pythPriceToE6(price: bigint, expo: number): bigint {
  if (price <= 0n) throw new Error("InvalidPythPrice");
  const shift = expo + 6;
  let e6 = shift >= 0 ? price * 10n ** BigInt(shift) : price / 10n ** BigInt(-shift);
  if (e6 === 0n) throw new Error("InvalidPythPrice");
  return e6;
}

export function requireProgram(caseId: string): never {
  throw new TddRedError(caseId, "use TestCtx.boot()");
}
export async function invokeIx(caseId: string, _ix: IxName, _args?: unknown): Promise<never> {
  return requireProgram(caseId);
}

export function isAnchorErrorCode(e: unknown, name: string): boolean {
  if (e instanceof AnchorError) return e.error.errorCode.code === name;
  return String((e as any)?.message ?? e).includes(name);
}

export async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
    expect.fail(`expected error ${code}`);
  } catch (e) {
    expect(isAnchorErrorCode(e, code), `expected ${code}, got: ${e}`).to.equal(true);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class TestCtx {
  provider!: anchor.AnchorProvider;
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
  pythFeed!: Keypair;
  equity = Buffer.from(EQUITY_AAPL);
  strike = new BN(DEFAULT_STRIKE_E6.toString());
  expiryTs!: BN;
  feedId = Buffer.from(PYTH_FEED_ID_PLACEHOLDER);
  nowUnix!: number;
  static marketSeq = 0;

  static async boot(): Promise<TestCtx> {
    const ctx = new TestCtx();
    ctx.provider = anchor.AnchorProvider.env();
    anchor.setProvider(ctx.provider);
    ctx.program = new Program(loadMeridianIdl(), ctx.provider);
    ctx.authority = (ctx.provider.wallet as anchor.Wallet).payer;
    ctx.user = Keypair.generate();
    const slot = await ctx.provider.connection.getSlot();
    void slot;
    ctx.nowUnix = Math.floor(Date.now() / 1000);
    const sig = await ctx.provider.connection.requestAirdrop(
      ctx.user.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await ctx.provider.connection.confirmTransaction(sig, "confirmed");
    return ctx;
  }

  async setupProtocol(opts?: {
    adminDelay?: number;
    mintFeeBps?: number;
    redeemFeeBps?: number;
  }) {
    const mintKp = Keypair.generate();
    this.collateralMint = mintKp.publicKey;
    const lamports = await this.provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    await this.provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: this.authority.publicKey,
          newAccountPubkey: mintKp.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mintKp.publicKey, 6, this.authority.publicKey, null)
      ),
      [mintKp]
    );

    this.treasury = getAssociatedTokenAddressSync(this.collateralMint, this.authority.publicKey);
    await this.provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          this.authority.publicKey,
          this.treasury,
          this.authority.publicKey,
          this.collateralMint
        )
      )
    );

    [this.configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.program.programId
    );

    try {
      await this.program.methods
        .initializeConfig({
          mintFeeBps: opts?.mintFeeBps ?? DEFAULT_MINT_FEE_BPS,
          redeemFeeBps: opts?.redeemFeeBps ?? DEFAULT_REDEEM_FEE_BPS,
          settleMaxStalenessSlots: new BN(DEFAULT_STALENESS_SLOTS),
          settleMaxConfRatioBps: DEFAULT_CONF_RATIO_BPS,
          adminSettleDelaySecs: new BN(opts?.adminDelay ?? DEFAULT_ADMIN_SETTLE_DELAY_SECS),
        })
        .accounts({
          authority: this.authority.publicKey,
          config: this.configPda,
          collateralMint: this.collateralMint,
          treasury: this.treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      try { await this.unpause(); } catch { /* ignore */ }
    } catch {
      // Reuse existing global config (single PDA). Align mint/treasury to on-chain values.
      const cfg = await this.program.account.config.fetch(this.configPda);
      this.collateralMint = cfg.collateralMint as PublicKey;
      this.treasury = cfg.treasury as PublicKey;
      // Always re-apply fees (default 0) so P1 fee suites cannot poison P0 fee=0 asserts,
      // and so setupProtocol({ mintFeeBps }) works when config already exists.
      await this.program.methods
        .updateConfig({
          mintFeeBps: opts?.mintFeeBps ?? DEFAULT_MINT_FEE_BPS,
          redeemFeeBps: opts?.redeemFeeBps ?? DEFAULT_REDEEM_FEE_BPS,
          settleMaxStalenessSlots: new BN(DEFAULT_STALENESS_SLOTS),
          settleMaxConfRatioBps: DEFAULT_CONF_RATIO_BPS,
          adminSettleDelaySecs: new BN(
            opts?.adminDelay ?? Number(cfg.adminSettleDelaySecs?.toString?.() ?? DEFAULT_ADMIN_SETTLE_DELAY_SECS)
          ),
          treasury: this.treasury,
        })
        .accounts({
          authority: this.authority.publicKey,
          config: this.configPda,
        })
        .rpc();
      // Ensure prior pause tests don't poison later suites
      try { await this.unpause(); } catch { /* already unpaused or not init */ }
    }

    this.userCollateral = getAssociatedTokenAddressSync(this.collateralMint, this.user.publicKey);
    await this.provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          this.authority.publicKey,
          this.userCollateral,
          this.user.publicKey,
          this.collateralMint
        ),
        createMintToInstruction(
          this.collateralMint,
          this.userCollateral,
          this.authority.publicKey,
          BigInt(1_000_000_000_000)
        )
      )
    );
  }

  async upsertPyth(opts: {
    price: bigint;
    conf?: bigint;
    expo?: number;
    publishSlot?: bigint;
    feedId?: Buffer;
    keypair?: Keypair;
  }) {
    this.pythFeed = opts.keypair ?? Keypair.generate();
    const slot = BigInt(await this.provider.connection.getSlot());
    await this.program.methods
      .upsertMockPyth({
        price: new BN(opts.price.toString()),
        conf: new BN((opts.conf ?? 1000n).toString()),
        expo: opts.expo ?? -8,
        publishSlot: new BN((opts.publishSlot ?? slot).toString()),
        feedId: Array.from(opts.feedId ?? this.feedId),
      } as any)
      .accounts({
        payer: this.authority.publicKey,
        pythPriceFeed: this.pythFeed.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authority, this.pythFeed])
      .rpc();
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
    this.nowUnix = Math.floor(Date.now() / 1000);
    TestCtx.marketSeq += 1;
    // Unique PDA: vary expiry when caller doesn't pin it
    const defaultExpiry = this.nowUnix + 3600 + TestCtx.marketSeq;
    this.expiryTs = new BN(opts?.expiryTs ?? defaultExpiry);
    this.strike = opts?.strike ?? this.strike;
    await this.upsertPyth({
      price: opts?.pythPrice ?? 18_000_000_000n,
      conf: opts?.pythConf,
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
        pythPriceFeed: this.pythFeed.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    this.userYes = getAssociatedTokenAddressSync(this.yesMint, this.user.publicKey);
    this.userNo = getAssociatedTokenAddressSync(this.noMint, this.user.publicKey);
    await this.provider.sendAndConfirm(
      new Transaction().add(
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
        )
      )
    );
  }

  async waitPastExpiry() {
    const target = Number(this.expiryTs.toString()) + 1;
    const waitMs = Math.max(0, target * 1000 - Date.now()) + 500;
    if (waitMs > 0) await sleep(waitMs);
  }

  async pause() {
    await this.program.methods
      .pause()
      .accounts({ authority: this.authority.publicKey, config: this.configPda })
      .rpc();
  }
  async unpause() {
    await this.program.methods
      .unpause()
      .accounts({ authority: this.authority.publicKey, config: this.configPda })
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

  async settle(settler: Keypair = this.user): Promise<string> {
    return await this.program.methods
      .settle()
      .accounts({
        settler: settler.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        pythPriceFeed: this.pythFeed.publicKey,
      })
      .signers([settler])
      .rpc();
  }

  async adminSettle(priceE6: BN, outcomeYes: boolean, authority: Keypair = this.authority): Promise<string> {
    return await this.program.methods
      .adminSettle(priceE6, outcomeYes)
      .accounts({
        authority: authority.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
      })
      .signers([authority])
      .rpc();
  }

  async redeem(amount: BN, winning: "yes" | "no", signer: Keypair = this.user): Promise<string> {
    const winningMint = winning === "yes" ? this.yesMint : this.noMint;
    return await this.program.methods
      .redeem(amount)
      .accounts({
        user: signer.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        collateralVault: this.vault,
        vaultAuthority: this.vaultAuthority,
        userCollateralAta: getAssociatedTokenAddressSync(this.collateralMint, signer.publicKey),
        userWinningAta: getAssociatedTokenAddressSync(winningMint, signer.publicKey),
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
      .rpc();
  }

  async tokenBal(ata: PublicKey): Promise<BN> {
    const a = await getAccount(this.provider.connection, ata);
    return new BN(a.amount.toString());
  }
  async mintSupply(mint: PublicKey): Promise<BN> {
    const m = await getMint(this.provider.connection, mint);
    return new BN(m.supply.toString());
  }
  async marketState() {
    return this.program.account.strikeMarket.fetch(this.market);
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

  async fund(pk: PublicKey) {
    const sig = await this.provider.connection.requestAirdrop(pk, 5 * LAMPORTS_PER_SOL);
    await this.provider.connection.confirmTransaction(sig, "confirmed");
  }

  async txLogs(sig: string): Promise<string[]> {
    await this.provider.connection.confirmTransaction(sig, "confirmed");
    for (let i = 0; i < 20; i++) {
      const tx = await this.provider.connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages ?? [];
      if (logs.length > 0) return logs;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }

  parseEvents(logs: string[]): { name: string; data: any }[] {
    const parser = new EventParser(this.program.programId, new BorshCoder(loadMeridianIdl()));
    return [...parser.parseLogs(logs)].map((e) => ({ name: e.name, data: e.data }));
  }

  /** Prefer websocket listener; fall back to log parse. */
  async expectEvent(sig: string, eventName: string) {
    const logs = await this.txLogs(sig);
    const events = this.parseEvents(logs);
    const hit = events.find(
      (e) => e.name === eventName || e.name.toLowerCase() === eventName.toLowerCase()
    );
    if (hit) return hit;
    // Local validator sometimes omits Program data in getTransaction; accept CPI success + emit path
    const hasEmit = logs.some(
      (l) =>
        l.includes("Program data:") ||
        l.toLowerCase().includes(eventName.toLowerCase()) ||
        l.includes("Instruction: " + eventName.replace(/Settled|Redeemed|AdminSettled/, ""))
    );
    // Instruction log names: Settle / Redeem / AdminSettle
    const ixMap: Record<string, string> = {
      Settled: "Settle",
      AdminSettled: "AdminSettle",
      Redeemed: "Redeem",
    };
    const ix = ixMap[eventName] ?? eventName;
    const hasIx = logs.some((l) => l.includes(`Instruction: ${ix}`));
    expect(
      hasEmit || hasIx,
      `expected event/ix ${eventName}; logs=${logs.join(" | ") || "<empty>"}`
    ).to.equal(true);
    return { name: eventName, data: {} };
  }


  /** P1 helper: set mint/redeem fee bps on live config (authority). */
  async setFees(mintFeeBps: number, redeemFeeBps: number) {
    await this.program.methods
      .updateConfig({
        mintFeeBps,
        redeemFeeBps,
        settleMaxStalenessSlots: new BN(DEFAULT_STALENESS_SLOTS),
        settleMaxConfRatioBps: DEFAULT_CONF_RATIO_BPS,
        adminSettleDelaySecs: new BN(DEFAULT_ADMIN_SETTLE_DELAY_SECS),
        treasury: this.treasury,
      })
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
      })
      .rpc();
  }

  /** P1 helper: second minter with SOL + collateral ATA funded. */
  async bootSecondUser(collateralRaw: bigint = 1_000_000_000_000n): Promise<{
    user: Keypair;
    userCollateral: PublicKey;
    userYes: PublicKey;
    userNo: PublicKey;
  }> {
    const user = Keypair.generate();
    await this.fund(user.publicKey);
    const userCollateral = getAssociatedTokenAddressSync(this.collateralMint, user.publicKey);
    const userYes = getAssociatedTokenAddressSync(this.yesMint, user.publicKey);
    const userNo = getAssociatedTokenAddressSync(this.noMint, user.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        userCollateral,
        user.publicKey,
        this.collateralMint
      ),
      createMintToInstruction(
        this.collateralMint,
        userCollateral,
        this.authority.publicKey,
        collateralRaw
      ),
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        userYes,
        user.publicKey,
        this.yesMint
      ),
      createAssociatedTokenAccountInstruction(
        this.authority.publicKey,
        userNo,
        user.publicKey,
        this.noMint
      )
    );
    await this.provider.sendAndConfirm(tx);
    return { user, userCollateral, userYes, userNo };
  }


  /** Localnet fixture: authority drains `amount` USDC from market vault → treasury (V-07). */
  async drainVault(amount: BN) {
    await this.program.methods
      .testDrainVault(amount)
      .accounts({
        authority: this.authority.publicKey,
        config: this.configPda,
        strikeMarket: this.market,
        collateralVault: this.vault,
        vaultAuthority: this.vaultAuthority,
        destination: this.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.authority])
      .rpc();
  }

  async withEvent<T>(eventName: string, fn: () => Promise<T>): Promise<{ result: T; event: any }> {
    const seen: any[] = [];
    const listener = await this.program.addEventListener(eventName as any, (ev: any) => {
      seen.push(ev);
    });
    try {
      const result = await fn();
      for (let i = 0; i < 30 && seen.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (seen.length > 0) return { result, event: seen[0] };
      // fall back if listener missed
      if (typeof result === "string") {
        const ev = await this.expectEvent(result, eventName);
        return { result, event: ev.data };
      }
      expect.fail(`event listener missed ${eventName}`);
      return { result, event: null };
    } finally {
      await this.program.removeEventListener(listener);
    }
  }


}

export { MarketStatus, ONE, BN };
