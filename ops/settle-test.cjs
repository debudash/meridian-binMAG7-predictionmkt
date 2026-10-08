/**
 * Short-expiry settle verification. node settle-test.cjs <mint|settle|redeem|status>
 * env: RPC, STATE, KEYS, WEB_NODE_MODULES, MERIDIAN_IDL (all required), ADMIN_PRICE_E6 + ADMIN_PRICE_SOURCE (admin_settle
 *      fallback price and where it came from — Reviewers mr72-73 M3: `ops-cli admin-price` gives the Hermes price at
 *      expiry or a market-bound operator price; a bare ADMIN_PRICE_E6 without a source is REFUSED. Policy A applies)
 *      PYTH_HERMES_API_KEY [+ PYTH_HERMES_URL] (DLV-085): `settle` first runs the permissionless Pyth PULL settle through
 *      the automation ops-cli ($AUTOMATION_DIST/ops-cli.js pull-settle: Hermes price at expiry → Pyth receiver post →
 *      settle, signed + paid by the settler). The key stays in the child's env (Authorization: Bearer); never printed,
 *      never in a URL. Without it (or AUTOMATION_DIST) the legacy sponsored-account settle is tried, then admin_settle.
 *      SETTLER_KEY (default $KEYS/settler.json): low-balance key that signs AND pays the permissionless `settle`
 *      (Reviewers M3 / !70). admin_settle stays authority-only (keeper). Missing settler file → keeper + WARNING.
 */
const fs = require("fs");
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} required (see header)`); return v; };
const W = need("WEB_NODE_MODULES").replace(/\/?$/, "/");
const { spawnSync } = require("child_process");
const { pullSettlePlan } = require("./lib/pull-settle.cjs");
const { adminPriceGuard } = require("./lib/admin-price.cjs");
const web3 = require(W + "@solana/web3.js"); const spl = require(W + "@solana/spl-token"); const anchor = require(W + "@coral-xyz/anchor");
const { PublicKey, Keypair, Connection, Transaction, ComputeBudgetProgram } = web3;
const RPC = need("RPC"), STATE = need("STATE"), KEYS = need("KEYS");
const IDL = need("MERIDIAN_IDL");
const AUTOMATION_DIST = process.env.AUTOMATION_DIST;
const SETTLER_KEY = process.env.SETTLER_KEY || `${KEYS}/settler.json`;
const kp = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${KEYS}/${n}.json`, "utf8"))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const conn = new Connection(RPC, "confirmed");
async function send(ixs, signers, label) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  const { blockhash } = await conn.getLatestBlockhash("confirmed"); tx.recentBlockhash = blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const raw = tx.serialize(); let sig;
  try { sig = await conn.sendRawTransaction(raw); } catch (e) { console.log(`  ${label}: REJECTED (preflight) ${(e.logs || []).filter((l) => /Error|failed/.test(l)).join(" | ") || e.message}`); return null; }
  for (let i = 0; i < 60; i++) { const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) { console.log(`  ${label}: FAILED ${JSON.stringify(st.err)} ${sig}`); return null; }
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") { console.log(`  ${label}: ${sig}`); return sig; }
    if (i % 5 === 4) await conn.sendRawTransaction(raw, { skipPreflight: true }).catch(() => {}); await sleep(1000); }
  console.log(`  ${label}: not confirmed ${sig}`); return null;
}
(async () => {
  const step = process.argv[2]; const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const m = state.markets.find((x) => x.short); const sm = new PublicKey(m.market);
  const idl = JSON.parse(fs.readFileSync(IDL, "utf8")); idl.address = state.programId;
  const prog = (k) => new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(k), { commitment: "confirmed" }));
  const keeper = kp("keeper"), trader = kp("trader"); const pk = prog(keeper), pt = prog(trader);
  const config = new PublicKey(state.configPda), usdc = new PublicKey(state.usdcMint), treasury = new PublicKey(state.treasury);
  const acc = await pk.account.strikeMarket.fetch(sm);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from("vault_authority"), sm.toBuffer()], new PublicKey(state.programId));
  const ata = (mint) => spl.getAssociatedTokenAddressSync(mint, trader.publicKey);
  const now = await conn.getBlockTime(await conn.getSlot());
  console.log(`${m.symbol} >= ${m.strikeE6 / 1e6} ${m.market} status=${acc.status} expiry=${new Date(acc.expiryTs.toNumber() * 1000).toISOString()} chainNow=${new Date(now * 1000).toISOString()} settlementPriceE6=${acc.settlementPriceE6}`);
  state.settleTest = state.settleTest || {};
  if (step === "mint") {
    const ix = await pt.methods.mint(new anchor.BN(5_000_000)).accounts({ user: trader.publicKey, config, strikeMarket: sm, collateralVault: acc.collateralVault, vaultAuthority,
      userCollateralAta: ata(usdc), userYesAta: ata(acc.yesMint), userNoAta: ata(acc.noMint), yesMint: acc.yesMint, noMint: acc.noMint, treasury, collateralMint: usdc, tokenProgram: spl.TOKEN_PROGRAM_ID, simClock: null }).instruction();
    state.settleTest.mintSig = await send([spl.createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(acc.yesMint), trader.publicKey, acc.yesMint),
      spl.createAssociatedTokenAccountIdempotentInstruction(trader.publicKey, ata(acc.noMint), trader.publicKey, acc.noMint), ix], [trader], "trader mint 5 pairs (short market)");
  }
  if (step === "settle") {
    // M3: permissionless settle is signed and paid by the separate low-balance settler (never the config authority).
    let settler = keeper;
    const plan = pullSettlePlan({ hermesKeySet: !!process.env.PYTH_HERMES_API_KEY, automationDist: AUTOMATION_DIST,
      opsCliExists: !!AUTOMATION_DIST && fs.existsSync(`${AUTOMATION_DIST}/ops-cli.js`), settlerKeyPath: SETTLER_KEY, settlerKeyExists: fs.existsSync(SETTLER_KEY) });
    if (fs.existsSync(SETTLER_KEY)) settler = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(SETTLER_KEY, "utf8"))));
    for (const w of plan.warnings) console.log(`  ${w}`);
    if (settler.publicKey.equals(keeper.publicKey)) console.log("  WARNING settler == authority (keeper)");
    state.settleTest.settler = settler.publicKey.toBase58();
    // DLV-085: permissionless Pyth pull settle (Hermes key) via the automation's tested code path.
    if (acc.status === 0 && plan.run) {
      const r = spawnSync(process.execPath, [`${AUTOMATION_DIST}/ops-cli.js`, "pull-settle", "--market", sm.toBase58()], {
        cwd: `${AUTOMATION_DIST}/..`, encoding: "utf8",
        env: { ...process.env, SOLANA_RPC_URL: RPC, SOLANA_CLUSTER: "devnet", MERIDIAN_PROGRAM_ID: state.programId, MERIDIAN_IDL_PATH: IDL, SETTLER_KEYPAIR: SETTLER_KEY } });
      const out = `${r.stdout || ""}${r.stderr || ""}`.split("\n").filter(Boolean).map((l) => `  ${l}`).join("\n");
      console.log(out);
      state.settleTest.pullSettle = { ok: r.status === 0, at: new Date().toISOString() };
    } else if (acc.status === 0) console.log(`  ${plan.skipLine}`);
    const mid = await pk.account.strikeMarket.fetch(sm); // status u8: 0 Open, 2 SettledYes, 3 SettledNo
    const ix = await pk.methods.settle().accounts({ settler: settler.publicKey, config, strikeMarket: sm, pythPriceFeed: acc.pythPriceFeed, simClock: null }).instruction();
    if (mid.status === 0) state.settleTest.pythSettleSig = await send([ix], [settler], `permissionless settle (sponsored Pyth account; settler ${settler.publicKey.toBase58()})`);
    const fresh = await pk.account.strikeMarket.fetch(sm);
    const guard = process.env.ADMIN_PRICE_E6 ? adminPriceGuard({ priceE6: process.env.ADMIN_PRICE_E6, source: process.env.ADMIN_PRICE_SOURCE }) : null;
    if (fresh.status === 0 && guard && !guard.ok) console.log(`  [settle] ALERT admin_settle REFUSED: ${guard.reason}`);
    if (fresh.status === 0 && guard && guard.ok) {
      console.log(`  ${guard.line}`); state.settleTest.adminPriceSource = process.env.ADMIN_PRICE_SOURCE;
      const price = BigInt(process.env.ADMIN_PRICE_E6); const yes = price >= BigInt(m.strikeE6);
      const ix2 = await pk.methods.adminSettle(new anchor.BN(price.toString()), yes).accounts({ authority: keeper.publicKey, config, strikeMarket: sm, simClock: null }).instruction();
      state.settleTest.adminSettleSig = await send([ix2], [keeper], `admin_settle price=${Number(price) / 1e6} outcomeYes=${yes}`);
    }
  }
  if (step === "redeem") {
    const f = await pk.account.strikeMarket.fetch(sm); const yesWins = f.status === 2 || f.status === "SettledYes";
    const win = yesWins ? f.yesMint : f.noMint; const before = (await conn.getTokenAccountBalance(ata(usdc))).value.uiAmount;
    const ix = await pt.methods.redeem(new anchor.BN(5_000_000)).accounts({ user: trader.publicKey, config, strikeMarket: sm, collateralVault: f.collateralVault, vaultAuthority,
      userCollateralAta: ata(usdc), userWinningAta: ata(win), winningMint: win, treasury, tokenProgram: spl.TOKEN_PROGRAM_ID }).instruction();
    state.settleTest.redeemSig = await send([ix], [trader], `redeem 5 ${yesWins ? "Yes" : "No"}`);
    const after = (await conn.getTokenAccountBalance(ata(usdc))).value.uiAmount; console.log(`  trader mUSDC ${before} → ${after}`); state.settleTest.redeemUsdc = { before, after };
  }
  const end = await pk.account.strikeMarket.fetch(sm); console.log(`  final status=${end.status} settlementPriceE6=${end.settlementPriceE6}`); state.settleTest.finalStatus = end.status; state.settleTest.settlementPriceE6 = end.settlementPriceE6.toString();
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
