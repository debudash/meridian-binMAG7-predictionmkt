/**
 * Calendar mode (prod/devnet/Railway): morning create + post-16:00 ET settle with real Pyth.
 * Must NOT import sim helpers or localnet fixture ixs.
 */
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AutomationConfig } from "../config";
import * as fs from "fs";
import { canSettleCalendar, getEtParts } from "../schedule";
import { decodeEquitySymbol, encodeEquitySymbol, StrikeSpec } from "../strikes";
import {
  atmStrikesE6,
  decideStrikeReference,
  defaultStrikeStepE6,
  etWall,
  OperatorDayPrices,
  sameDaySession,
  StrikeReferenceDecision,
} from "../marketDay";
import { decideAdminFallbackPrice } from "../pyth/adminFallback";
import { fetchLatestPrice } from "../pyth/hermes";
import { decodePriceUpdateV2, PullPrice } from "../pyth/pullOracle";
import {
  adminSettleMarket,
  createStrikeMarket,
  fetchOpenMarkets,
  MarketStatus,
  setPhoenixMarket,
  settleMarket,
} from "../solana/instructions";
import { configPda } from "../solana/pdas";
import { livePullSettleDeps, publishWindowSecs, settleWithPullOracle, PullSettleDeps } from "../solana/pullSettle";

export interface TrackedMarket {
  market: PublicKey;
  symbol: string;
  pythPriceFeed: PublicKey;
  expiryTs: number;
  settleAttempts: number;
  createdDateKey: string;
}

export interface CalendarState {
  tracked: TrackedMarket[];
  lastCreateDateKey: string | null;
}

export function createCalendarState(): CalendarState {
  return { tracked: [], lastCreateDateKey: null };
}

function log(msg: string, extra?: unknown) {
  const line = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`;
  console.log(`[calendar] ${line}`);
}

/** DLV-118: operator-sourced day prices, inline env JSON or a file read at use time (operator may drop it later). */
export function loadOperatorDayPrices(cfg: AutomationConfig, kind: "strike" | "close"): OperatorDayPrices | null {
  const raw = kind === "strike" ? cfg.operatorStrikePricesRaw : cfg.operatorClosePricesRaw;
  const file = kind === "strike" ? cfg.operatorStrikePricesFile : cfg.operatorClosePricesFile;
  let text = raw;
  if (!text && file) {
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  if (!text || !text.trim()) return null;
  try {
    const j = JSON.parse(text);
    if (typeof j?.dateKey !== "string" || typeof j?.pricesE6 !== "object" || j.pricesE6 === null) {
      log(`ALERT operator ${kind} prices ignored: want {dateKey, source, pricesE6}`);
      return null;
    }
    const pricesE6: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.pricesE6)) pricesE6[k.toUpperCase()] = String(v);
    return { dateKey: j.dateKey, source: String(j.source ?? ""), pricesE6 };
  } catch (e) {
    log(`ALERT operator ${kind} prices are not valid JSON: ${String(e).slice(0, 120)}`);
    return null;
  }
}

/** DLV-118: fresh strike reference for one symbol — Hermes latest (if a key / seam) else the operator day price. */
export async function strikeReferenceFor(
  cfg: AutomationConfig,
  symbol: string,
  dateKey: string,
  nowSec: number,
  operator: OperatorDayPrices | null,
  hermesLatest?: (feedIdHex: string) => Promise<PullPrice>,
  readAccount?: (pk: PublicKey) => Promise<Buffer | null>,
): Promise<StrikeReferenceDecision> {
  const feedIdHex = cfg.pythFeedIds[symbol]?.toString("hex");
  let onchain: { parsed: PullPrice; account: string } | { error: string } | undefined;
  const feedPk = cfg.pythPriceFeeds[symbol];
  if (readAccount && feedPk) {
    try {
      const data = await readAccount(feedPk);
      onchain = data ? { parsed: decodePriceUpdateV2(data), account: feedPk.toBase58() } : { error: `${feedPk.toBase58()} not found` };
    } catch (e) {
      onchain = { error: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  }
  let hermes: { parsed: PullPrice } | { error: string } | undefined;
  if (feedIdHex && (hermesLatest || cfg.pythHermesApiKey)) {
    try {
      const parsed = hermesLatest
        ? await hermesLatest(feedIdHex)
        : await fetchLatestPrice({ baseUrl: cfg.pythHermesUrl, apiKey: cfg.pythHermesApiKey, feedIdHex });
      hermes = { parsed };
    } catch (e) {
      hermes = { error: String((e as Error)?.message ?? e).slice(0, 160) };
    }
  }
  return decideStrikeReference({
    symbol, dateKey, nowSec, feedIdHex, maxAgeSecs: cfg.strikeRefMaxAgeSecs, maxConfBps: 500, hermes, onchain, operator: operator ?? undefined,
  });
}

/**
 * DLV-118: today's plan for ops (run-staging.sh → devnet-bootstrap.cjs via `ops-cli market-day --strikes`):
 * session (expiry = 16:00 ET today) + one ATM strike per symbol from a fresh reference; refused symbols listed.
 */
export async function planDayForOps(
  cfg: AutomationConfig,
  nowSec: number,
  hermesLatest?: (feedIdHex: string) => Promise<PullPrice>,
  readAccount?: (pk: PublicKey) => Promise<Buffer | null>,
): Promise<
  | { ok: true; dateKey: string; openTs: number; closeTs: number; markets: Array<{ symbol: string; strikeE6: string; refE6: string; source: string }>; refused: Array<{ symbol: string; reason: string }> }
  | { ok: false; code: string; reason: string; dateKey: string; nextDateKey?: string }
> {
  const s = sameDaySession(nowSec);
  if (!s.ok) return { ok: false, code: s.code, reason: s.reason, dateKey: s.dateKey, nextDateKey: s.nextDateKey };
  const operator = loadOperatorDayPrices(cfg, "strike");
  const markets: Array<{ symbol: string; strikeE6: string; refE6: string; source: string }> = [];
  const refused: Array<{ symbol: string; reason: string }> = [];
  for (const symbol of cfg.symbols) {
    const d = await strikeReferenceFor(cfg, symbol, s.plan.dateKey, nowSec, operator, hermesLatest, readAccount);
    if (!d.ok) {
      refused.push({ symbol, reason: d.reason });
      continue;
    }
    const [strike] = atmStrikesE6(d.priceE6, [0], cfg.strikeStepE6 ?? defaultStrikeStepE6(d.priceE6));
    markets.push({ symbol, strikeE6: strike.toString(), refE6: d.priceE6.toString(), source: d.source });
  }
  return { ok: true, dateKey: s.plan.dateKey, openTs: s.plan.openTs, closeTs: s.plan.closeTs, markets, refused };
}

/**
 * DLV-118: today's strikes. expiry = that ET day's 16:00 close (sameDaySession); ATM strike from the fresh reference
 * rounded to STRIKE_STEP_E6 (default $5 ≥ $100, else $1) plus STRIKE_OFFSETS_E6. After the close → { ok:false }.
 */
export function planSameDayStrikes(
  cfg: AutomationConfig,
  nowSec: number,
  refsE6: Record<string, bigint>,
): { ok: true; dateKey: string; closeTs: number; strikes: StrikeSpec[] } | { ok: false; code: string; reason: string } {
  const s = sameDaySession(nowSec);
  if (!s.ok) return { ok: false, code: s.code, reason: s.reason };
  const strikes: StrikeSpec[] = [];
  for (const [symbol, refE6] of Object.entries(refsE6)) {
    const key = symbol.toUpperCase();
    const step = cfg.strikeStepE6 ?? defaultStrikeStepE6(refE6);
    for (const strikeE6 of atmStrikesE6(refE6, cfg.strikeOffsetsE6, step)) {
      const feedId = cfg.pythFeedIds[key] ?? Buffer.alloc(32, 0);
      strikes.push({
        symbol: key,
        equitySymbol: encodeEquitySymbol(key),
        strikePriceE6: new BN(strikeE6.toString()),
        expiryTs: new BN(s.plan.closeTs),
        pythFeedId: feedId,
        phoenixMarket: cfg.phoenixMarkets[key] ?? PublicKey.default,
      });
    }
  }
  return { ok: true, dateKey: s.plan.dateKey, closeTs: s.plan.closeTs, strikes };
}

/**
 * DLV-118: create each trading day's markets at the 9:30 ET open (window [09:30, 16:00) ET, weekends / NYSE
 * holidays skipped), expiry = that day's 16:00 ET close. Never after the close (no next-day roll).
 * Idempotent: once per ET day, and a symbol that already has an open market expiring today is skipped (restarts).
 * A symbol without a fresh reference price is skipped with an ALERT and the day stays un-done so the next tick
 * retries once the operator price lands. Name kept for worker/back-compat (was the ~08:00 "morning" create).
 */
export async function runMorningCreate(opts: {
  cfg: AutomationConfig;
  program: Program;
  authority: Keypair;
  state: CalendarState;
  now?: Date;
  /** Test seams */
  listOpen?: () => Promise<Array<{ publicKey: PublicKey; account: any }>>;
  hermesLatest?: (feedIdHex: string) => Promise<PullPrice>;
  readAccount?: (pk: PublicKey) => Promise<Buffer | null>;
  create?: (strike: StrikeSpec) => Promise<{ market: PublicKey; signature: string }>;
}): Promise<TrackedMarket[]> {
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const session = sameDaySession(nowSec, { requireOpen: true });
  if (!session.ok) {
    log(`skip create — ${session.code}: ${session.reason}`);
    return [];
  }
  const { dateKey, closeTs } = session.plan;
  if (opts.state.lastCreateDateKey === dateKey) {
    log(`skip create — already ran for ${dateKey}`);
    return [];
  }
  if (!opts.cfg.collateralMint) {
    throw new Error("COLLATERAL_MINT required for create_strike_market");
  }

  // Restart idempotency: symbols that already have an open market expiring at today's close.
  const have = new Set<string>();
  try {
    const open = await (opts.listOpen ? opts.listOpen() : fetchOpenMarkets(opts.program));
    for (const m of open) {
      const exp = Number(m.account.expiryTs?.toString?.() ?? m.account.expiry_ts ?? 0);
      if (exp === closeTs) have.add(decodeEquitySymbol(m.account.equitySymbol ?? m.account.equity_symbol ?? []));
    }
  } catch (e) {
    log(`open-market scan failed (continuing; PDA collisions still prevent duplicates for equal strikes): ${String(e).slice(0, 160)}`);
  }

  const operator = loadOperatorDayPrices(opts.cfg, "strike");
  const refs: Record<string, bigint> = {};
  let missingPrice = 0;
  for (const symbol of opts.cfg.symbols) {
    if (have.has(symbol)) {
      log(`skip ${symbol} — already has a market expiring ${dateKey} 16:00 ET`);
      continue;
    }
    // D-025: off-localnet a market with a zero feed id can never permissionless-settle.
    if (opts.cfg.cluster !== "localnet" && !opts.cfg.pythFeedIds[symbol]) {
      log(`skip ${symbol} — missing PYTH_FEED_IDS entry (required off-localnet, D-025)`);
      continue;
    }
    if (!opts.cfg.pythPriceFeeds[symbol]) {
      log(`skip ${symbol} — missing PYTH_PRICE_FEEDS entry`);
      continue;
    }
    const conn = (opts.program as any)?.provider?.connection;
    const readAccount =
      opts.readAccount ?? (conn?.getAccountInfo ? async (pk: PublicKey) => (await conn.getAccountInfo(pk, "confirmed"))?.data ?? null : undefined);
    const d = await strikeReferenceFor(opts.cfg, symbol, dateKey, nowSec, operator, opts.hermesLatest, readAccount);
    if (!d.ok) {
      missingPrice++;
      log(`ALERT no fresh strike reference for ${symbol} on ${dateKey} — not created: ${d.reason}`);
      continue;
    }
    log(`strike reference ${symbol} ${d.priceE6} (${d.source})`);
    refs[symbol] = d.priceE6;
  }

  const plan = planSameDayStrikes(opts.cfg, nowSec, refs);
  if (!plan.ok) {
    log(`skip create — ${plan.code}: ${plan.reason}`);
    return [];
  }
  const created: TrackedMarket[] = [];
  for (const strike of plan.strikes) {
    const feed = opts.cfg.pythPriceFeeds[strike.symbol];
    try {
      const { market, signature } = opts.create
        ? await opts.create(strike)
        : await createStrikeMarket({ program: opts.program, authority: opts.authority, collateralMint: opts.cfg.collateralMint, pythPriceFeed: feed, strike });
      log(`created market`, { market: market.toBase58(), sig: signature, symbol: strike.symbol, strikeE6: strike.strikePriceE6.toString(), expiryTs: closeTs });

      const phoenix = opts.cfg.phoenixMarkets[strike.symbol];
      if (!opts.create && phoenix && !phoenix.equals(PublicKey.default)) {
        // Phoenix market *create* stubbed — wiring only when pubkey provided.
        const sig2 = await setPhoenixMarket({ program: opts.program, authority: opts.authority, market, phoenixMarket: phoenix });
        log(`set_phoenix_market`, { market: market.toBase58(), phoenix: phoenix.toBase58(), sig: sig2 });
      } else if (!opts.create) {
        log(`phoenix create TODO — no PHOENIX_MARKETS.${strike.symbol}; skipped set_phoenix_market`);
      }

      const tracked: TrackedMarket = {
        market,
        symbol: strike.symbol,
        pythPriceFeed: feed,
        expiryTs: closeTs,
        settleAttempts: 0,
        createdDateKey: dateKey,
      };
      opts.state.tracked.push(tracked);
      created.push(tracked);
    } catch (e) {
      log(`create failed for ${strike.symbol}@${strike.strikePriceE6.toString()}: ${e}`);
    }
  }

  // Missing operator price → leave the day open so the next tick retries once it lands.
  if (missingPrice === 0) opts.state.lastCreateDateKey = dateKey;
  return created;
}

/**
 * Settle open markets past expiry with real Pyth, respecting ≥16:00 ET calendar gate.
 * Retries; admin_settle only with authority after delay + retry threshold.
 */
export async function runSettlePass(opts: {
  cfg: AutomationConfig;
  program: Program;
  authority: Keypair;
  /**
   * M3: low-balance key (and a Program whose provider wallet is that key, so it is also the fee
   * payer) for permissionless settle. Omitted → the authority (devnet/localnet fallback only).
   */
  settler?: { keypair: Keypair; program: Program };
  state: CalendarState;
  now?: Date;
  /** Test seam: override pull-oracle deps per market. */
  pullDeps?: (market: PublicKey, settler: Keypair, program: Program) => PullSettleDeps;
}): Promise<void> {
  const settler = opts.settler ?? { keypair: opts.authority, program: opts.program };
  const now = opts.now ?? new Date();
  if (!canSettleCalendar(now, opts.cfg.settleHourEt)) {
    // Expected idle state every tick before the close: informational, not an error.
    const p = getEtParts(now);
    log(`waiting for ${opts.cfg.settleHourEt}:00 ET gate (now ${p.hour}:${String(p.minute).padStart(2, "0")} ET)`);
    return;
  }

  const nowUnix = Math.floor(now.getTime() / 1000);

  // Refresh from chain so worker restarts still settle.
  let open: Array<{ publicKey: PublicKey; account: any }> = [];
  try {
    open = await fetchOpenMarkets(opts.program);
  } catch (e) {
    log(`fetchOpenMarkets failed: ${e}`);
    return;
  }

  // D-025: off-localnet the prod program only accepts Pyth pull-oracle PriceUpdateV2 accounts.
  const pull = opts.cfg.cluster !== "localnet";
  let rule = { windowSecs: 60, maxConfBps: 500 };
  if (pull && open.some((m) => Number(m.account.expiryTs?.toString?.() ?? 0) <= nowUnix)) {
    try {
      const c = await (opts.program.account as any).config.fetch(configPda(opts.program.programId)[0]);
      rule = {
        windowSecs: publishWindowSecs(BigInt(c.settleMaxStalenessSlots.toString())),
        maxConfBps: Number(c.settleMaxConfRatioBps),
      };
    } catch (e) {
      log(`config fetch failed; using D-005 defaults`, { err: String(e) });
    }
  }

  for (const m of open) {
    const expiry = Number(m.account.expiryTs?.toString?.() ?? m.account.expiry_ts ?? 0);
    if (expiry > nowUnix) continue;

    let tracked = opts.state.tracked.find((t) => t.market.equals(m.publicKey));
    if (!tracked) {
      const symBuf = m.account.equitySymbol ?? m.account.equity_symbol;
      const symbol = Buffer.from(symBuf).toString("utf8").replace(/\0/g, "").trim() || "UNKNOWN";
      const feed =
        opts.cfg.pythPriceFeeds[symbol] ??
        (m.account.pythPriceFeed as PublicKey) ??
        (m.account.pyth_price_feed as PublicKey);
      tracked = {
        market: m.publicKey,
        symbol,
        pythPriceFeed: feed,
        expiryTs: expiry,
        settleAttempts: 0,
        createdDateKey: "",
      };
      opts.state.tracked.push(tracked);
    }

    tracked.settleAttempts += 1;
    let pullWhy = "settle not attempted";
    if (pull) {
      const feedIdHex = Buffer.from(m.account.pythFeedId ?? m.account.pyth_feed_id ?? []).toString("hex");
      const deps =
        opts.pullDeps?.(tracked.market, settler.keypair, settler.program) ??
        livePullSettleDeps({
          program: settler.program,
          connection: (settler.program.provider as any).connection,
          settler: settler.keypair,
          market: tracked.market,
          hermesUrl: opts.cfg.pythHermesUrl,
          hermesApiKey: opts.cfg.pythHermesApiKey,
        });
      try {
        const r = await settleWithPullOracle(
          { market: tracked.market, expiryTs: expiry, feedIdHex, sponsoredFeed: tracked.pythPriceFeed ?? null },
          rule,
          deps
        );
        if (r.ok) {
          log(`settled (pull oracle, ${r.via})`, { market: tracked.market.toBase58(), sigs: r.signatures });
          tracked.settleAttempts = 0;
          continue;
        }
        pullWhy = String(r.reason ?? "pull settle not possible");
        log(`pull settle not possible yet`, {
          market: tracked.market.toBase58(),
          attempts: tracked.settleAttempts,
          reason: r.reason,
          needsApiKey: r.needsApiKey ?? false,
        });
      } catch (e) {
        pullWhy = String(e).slice(0, 200);
        log(`pull settle failed`, { market: tracked.market.toBase58(), attempts: tracked.settleAttempts, err: String(e) });
      }
    } else {
      try {
        const sig = await settleMarket({
          program: settler.program,
          settler: settler.keypair,
          market: tracked.market,
          pythPriceFeed: tracked.pythPriceFeed,
        });
        log(`settled`, { market: tracked.market.toBase58(), sig, attempts: tracked.settleAttempts });
        tracked.settleAttempts = 0;
        continue;
      } catch (e) {
        pullWhy = String(e).slice(0, 200);
        log(`settle retry failed`, {
          market: tracked.market.toBase58(),
          attempts: tracked.settleAttempts,
          err: String(e),
        });
      }
    }

    if (tracked.settleAttempts >= opts.cfg.adminSettleAfterRetries) {
      // DLV-118: admin_settle at the close via the OPERATOR-sourced close price while Hermes lacks equities (DLV-106).
      // decideAdminFallbackPrice (M3): a valid Hermes price wins; else an operator price bound to THIS market (its
      // symbol on its own ET day) with a source; else REFUSED + ALERT. Outcome = price ≥ strike (D-005).
      // The old unsourced static ADMIN_SETTLE_PRICE_E6 / _OUTCOME_YES path is localnet-only now.
      const strikeE6 = BigInt(m.account.strikePriceE6?.toString?.() ?? m.account.strike_price_e6?.toString?.() ?? "0");
      const marketDay = etWall(expiry).dateKey;
      const day = loadOperatorDayPrices(opts.cfg, "close");
      const opPrice = day && day.dateKey === marketDay ? day.pricesE6[tracked.symbol] : undefined;
      let priceE6: bigint | null = null;
      let source = "";
      let outcomeYes: boolean | null = null;
      if (opts.cfg.cluster === "localnet" && !day && opts.cfg.adminSettlePriceE6 !== null && opts.cfg.adminSettleOutcomeYes !== null) {
        priceE6 = opts.cfg.adminSettlePriceE6;
        outcomeYes = opts.cfg.adminSettleOutcomeYes;
        source = "localnet static ADMIN_SETTLE_PRICE_E6 (deprecated)";
      } else {
        const d = decideAdminFallbackPrice({
          market: tracked.market.toBase58(),
          expiryTs: expiry,
          feedIdHex: Buffer.from(m.account.pythFeedId ?? m.account.pyth_feed_id ?? []).toString("hex"),
          maxSkewSecs: 60,
          maxConfBps: rule.maxConfBps,
          hermes: { error: pullWhy },
          operator: opPrice
            ? { priceE6: opPrice, source: day!.source, market: tracked.market.toBase58() }
            : undefined,
        });
        if (!d.ok) {
          const why = day && day.dateKey !== marketDay ? `operator close prices are for ${day.dateKey}, market closed ${marketDay}` : d.reason;
          log(`ALERT admin_settle fallback REFUSED for ${tracked.symbol} ${tracked.market.toBase58()}: ${why} — ` +
            `set OPERATOR_CLOSE_PRICES(_FILE) {dateKey:"${marketDay}", source, pricesE6:{${tracked.symbol}:"<micro-USD>"}}` +
            (opts.cfg.adminSettlePriceE6 !== null ? " (static ADMIN_SETTLE_PRICE_E6 is ignored off-localnet: no unsourced price)" : ""));
        } else if (strikeE6 > 0n) {
          priceE6 = d.priceE6;
          source = d.source;
          outcomeYes = d.priceE6 >= strikeE6;
        }
      }
      if (priceE6 !== null && outcomeYes !== null) {
        // admin_settle: on-chain enforces expiry + admin_settle_delay_secs.
        try {
          const sig = await adminSettleMarket({
            program: opts.program,
            authority: opts.authority,
            market: tracked.market,
            settlementPriceE6: new BN(priceE6.toString()),
            outcomeYes,
          });
          log(`admin_settle`, { market: tracked.market.toBase58(), sig, priceE6: priceE6.toString(), outcomeYes, source });
        } catch (e) {
          log(`admin_settle failed (delay may remain): ${e}`);
        }
      }
    }
  }

  void MarketStatus;
}
