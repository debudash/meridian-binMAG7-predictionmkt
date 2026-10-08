/**
 * Calendar mode (prod/devnet/Railway): morning create (D-026: from 07:00, by 08:00 ET, on the prior close) + post-16:00 ET
 * settle with real Pyth.
 * Must NOT import sim helpers or localnet fixture ixs.
 */
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AutomationConfig, isLoopbackRpc } from "../config";
import * as fs from "fs";
import { canSettleCalendar, getEtParts } from "../schedule";
import { decodeEquitySymbol, encodeEquitySymbol, StrikeSpec } from "../strikes";
import {
  atmStrikesE6,
  calendarHorizonAlert,
  decideStrikeReference,
  defaultStrikeStepE6,
  etWall,
  etWallClockToUnix,
  isAlertCode,
  OperatorDayPrices,
  priorSessionClose,
  sameDaySession,
  StrikeReferenceDecision,
} from "../marketDay";
import { decideAdminFallbackPrice } from "../pyth/adminFallback";
import { fetchUpdateAt } from "../pyth/hermes";
import { decodePriceUpdateV2, PullPrice, PYTH_RECEIVER_PROGRAM_ID } from "../pyth/pullOracle";
import {
  adminSettleMarket,
  createStrikeMarket,
  fetchOpenMarkets,
  MarketStatus,
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
  /**
   * DLV-119 L-3: the strikes chosen for the day (first successful reference per symbol). A retry after a failed
   * create re-uses them, so a moved reference never makes a second set for that symbol.
   */
  dayPlan?: { dateKey: string; strikes: Record<string, string[]> };
  /** ET day the once-a-day ALERTs (calendar horizon, ignored PHOENIX_MARKETS) were last logged. */
  lastDailyAlertKey?: string | null;
  /** D-026: ET day the "create deadline missed" ALERT was last logged (once per day). */
  lastDeadlineAlertKey?: string | null;
  /**
   * D-026 review M1: gaps that do not block marking the day done (symbol skipped for config, fewer markets than planned),
   * so a later "already ran" tick past the deadline still ALERTs. Retried gaps (no price, failed create) keep the day open.
   */
  dayGaps?: { dateKey: string; gaps: string[] };
  /** D-026 review N3: symbol → ET day its "no prior-close strike reference" ALERT was last logged (once per day). */
  refAlertDay?: Record<string, string>;
}

/** D-026 seam: Hermes price AT a unix time (first update with publish_time >= `publishTime`). */
export type HermesAt = (feedIdHex: string, publishTime: number) => Promise<PullPrice>;

/** On-chain account read seam: data + owner (DLV-119 L-6 verifies the owner). */
export type ReadAccount = (pk: PublicKey) => Promise<{ data: Buffer; owner: PublicKey } | null>;

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
    // Review L3: the raw closeDateKey is kept (any type) so decideStrikeReference refuses a wrong one with a reason.
    return { dateKey: j.dateKey, ...("closeDateKey" in j ? { closeDateKey: j.closeDateKey } : {}), source: String(j.source ?? ""), pricesE6 };
  } catch (e) {
    log(`ALERT operator ${kind} prices are not valid JSON: ${String(e).slice(0, 120)}`);
    return null;
  }
}

/**
 * D-026: strike reference for one symbol on market day `dateKey` = the previous trading day's close — Hermes at the prior
 * close (if a key / seam) → sponsored on-chain account at the prior close → the operator prior close.
 */
export async function strikeReferenceFor(
  cfg: AutomationConfig,
  symbol: string,
  dateKey: string,
  operator: OperatorDayPrices | null,
  hermesAt?: HermesAt,
  readAccount?: ReadAccount,
): Promise<StrikeReferenceDecision> {
  let prevClose: { dateKey: string; closeTs: number };
  try {
    prevClose = priorSessionClose(dateKey);
  } catch (e) {
    return { ok: false, reason: `no previous trading day for ${dateKey}: ${String((e as Error)?.message ?? e)}` };
  }
  const feedIdHex = cfg.pythFeedIds[symbol]?.toString("hex");
  let onchain: { parsed: PullPrice; account: string } | { error: string } | undefined;
  const feedPk = cfg.pythPriceFeeds[symbol];
  if (readAccount && feedPk) {
    try {
      const acct = await readAccount(feedPk);
      if (!acct) onchain = { error: `${feedPk.toBase58()} not found` };
      else if (!acct.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) {
        // L-6: only a Pyth receiver-owned PriceUpdateV2 is a price; anything else is ignored.
        onchain = { error: `${feedPk.toBase58()} owner ${acct.owner.toBase58()} is not the Pyth receiver` };
      } else {
        const d = decodePriceUpdateV2(acct.data);
        onchain = d.fullyVerified ? { parsed: d, account: feedPk.toBase58() } : { error: `${feedPk.toBase58()} is not Full-verified (partial Wormhole verification)` };
      }
    } catch (e) {
      onchain = { error: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  }
  let hermes: { parsed: PullPrice } | { error: string } | undefined;
  if (feedIdHex && (hermesAt || cfg.pythHermesApiKey)) {
    try {
      const parsed = hermesAt
        ? await hermesAt(feedIdHex, prevClose.closeTs)
        : (await fetchUpdateAt({ baseUrl: cfg.pythHermesUrl, apiKey: cfg.pythHermesApiKey, feedIdHex, publishTime: prevClose.closeTs })).parsed;
      hermes = { parsed };
    } catch (e) {
      hermes = { error: String((e as Error)?.message ?? e).slice(0, 160) };
    }
  }
  return decideStrikeReference({
    symbol, dateKey, prevClose, feedIdHex, maxSkewSecs: cfg.priorCloseMaxSkewSecs, maxConfBps: 500, hermes, onchain, operator: operator ?? undefined,
  });
}

/**
 * DLV-118 / D-026: today's plan for ops (run-staging.sh → devnet-bootstrap.cjs via `ops-cli market-day --strikes`):
 * session (expiry = 16:00 ET today) + one ATM strike per symbol on the prior close (same rule as the worker); refused
 * symbols listed. No create-window gate (ops runs it by hand).
 */
export async function planDayForOps(
  cfg: AutomationConfig,
  nowSec: number,
  hermesAt?: HermesAt,
  readAccount?: ReadAccount,
): Promise<
  | {
      ok: true; dateKey: string; openTs: number; closeTs: number; prevDateKey: string; prevCloseTs: number;
      markets: Array<{ symbol: string; strikeE6: string; refE6: string; source: string }>; refused: Array<{ symbol: string; reason: string }>;
    }
  | { ok: false; code: string; reason: string; dateKey: string; nextDateKey?: string }
> {
  const s = sameDaySession(nowSec);
  if (!s.ok) return { ok: false, code: s.code, reason: s.reason, dateKey: s.dateKey, nextDateKey: s.nextDateKey };
  let prev: { dateKey: string; closeTs: number };
  try {
    prev = priorSessionClose(s.plan.dateKey);
  } catch (e) {
    return { ok: false, code: "unknown_year", reason: String((e as Error)?.message ?? e), dateKey: s.plan.dateKey };
  }
  const operator = loadOperatorDayPrices(cfg, "strike");
  const markets: Array<{ symbol: string; strikeE6: string; refE6: string; source: string }> = [];
  const refused: Array<{ symbol: string; reason: string }> = [];
  for (const symbol of cfg.symbols) {
    if (!cfg.pythFeedIds[symbol]) {
      // L-6: a market without a feed id can never permissionless-settle (D-025), and the feed check needs it.
      refused.push({ symbol, reason: `missing PYTH_FEED_IDS.${symbol} (required, D-025)` });
      continue;
    }
    const d = await strikeReferenceFor(cfg, symbol, s.plan.dateKey, operator, hermesAt, readAccount);
    if (!d.ok) {
      refused.push({ symbol, reason: d.reason });
      continue;
    }
    const [strike] = atmStrikesE6(d.priceE6, [0], cfg.strikeStepE6 ?? defaultStrikeStepE6(d.priceE6));
    markets.push({ symbol, strikeE6: strike.toString(), refE6: d.priceE6.toString(), source: d.source });
  }
  return { ok: true, dateKey: s.plan.dateKey, openTs: s.plan.openTs, closeTs: s.plan.closeTs, prevDateKey: prev.dateKey, prevCloseTs: prev.closeTs, markets, refused };
}

/**
 * DLV-118: today's strikes. expiry = that ET day's 16:00 close (sameDaySession); ATM strike from the reference (the prior
 * close, D-026) rounded to STRIKE_STEP_E6 (default $5 ≥ $100, else $1) plus STRIKE_OFFSETS_E6. After the close → { ok:false }.
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
        // L-8: never a static PHOENIX_MARKETS book for a new daily market (its base mint is another market's Yes).
        phoenixMarket: PublicKey.default,
      });
    }
  }
  return { ok: true, dateKey: s.plan.dateKey, closeTs: s.plan.closeTs, strikes };
}

/**
 * D-026 (supersedes DLV-118's 09:30-open create): create each trading day's markets in [CREATE_FROM_ET (07:00), 16:00) ET
 * (weekends / NYSE holidays skipped), expiry = that day's 16:00 ET close, strikes ATM on the previous trading day's
 * close. Never after the close (no next-day roll).
 * Deadline (review M1): decided AFTER the on-chain scan and the create pass, so a restart past 08:00 with every market
 * on-chain is silent. Past CREATE_DEADLINE_ET (08:00) it ALERTs once that day when the day is incomplete: no price, a
 * failed create, a symbol skipped for a missing PYTH_FEED_IDS / PYTH_PRICE_FEEDS entry, fewer markets than planned, or
 * markets that only got created now (late start). No price / failed create keep retrying every tick until the close.
 * DLV-119 (Reviewers !91):
 *   - early-close days and calendar gaps are refused with an ALERT (M-1);
 *   - the open-market scan must succeed, else nothing is created this tick (ALERT, retry) — no blind create (L-1);
 *   - a failed create is an ALERT and the day stays open; the retry creates only the missing strikes of the day's
 *     FIRST plan (L-3), so it is idempotent even when the reference moved;
 *   - PHOENIX_MARKETS is ignored for daily markets (ALERT once a day if set) until the worker creates books (L-8).
 * A symbol without a prior-close reference price is skipped with an ALERT and the day stays un-done so the next tick retries.
 */
export async function runMorningCreate(opts: {
  cfg: AutomationConfig;
  program: Program;
  authority: Keypair;
  state: CalendarState;
  now?: Date;
  /** Test seams */
  listOpen?: () => Promise<Array<{ publicKey: PublicKey; account: any }>>;
  hermesAt?: HermesAt;
  readAccount?: ReadAccount;
  create?: (strike: StrikeSpec) => Promise<{ market: PublicKey; signature: string }>;
}): Promise<TrackedMarket[]> {
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const today = etWall(nowSec).dateKey;
  if (opts.state.lastDailyAlertKey !== today) {
    const horizon = calendarHorizonAlert(nowSec);
    if (horizon) log(horizon);
    if (Object.keys(opts.cfg.phoenixMarkets).length) {
      log(`ALERT PHOENIX_MARKETS is set but ignored for daily markets (L-8: a fixed book belongs to an older market's Yes mint); keep it empty until the worker creates books`);
    }
    opts.state.lastDailyAlertKey = today;
  }
  const session = sameDaySession(nowSec, { notBeforeEt: opts.cfg.createFromEt });
  if (!session.ok) {
    log(`${isAlertCode(session.code) ? "ALERT " : ""}skip create — ${session.code}: ${session.reason.replace(/^ALERT /, "")}`);
    return [];
  }
  const { dateKey, closeTs } = session.plan;
  // D-026 (Peak6 PRD "market creation by 8:00 AM ET"): past the deadline with the day incomplete → page ops once that day.
  const dl = opts.cfg.createDeadlineEt;
  const deadlineAlert = (gaps: string[]) => {
    if (!gaps.length || nowSec < etWallClockToUnix(dateKey, dl.hour, dl.minute) || opts.state.lastDeadlineAlertKey === dateKey) return;
    const hhmm = `${String(dl.hour).padStart(2, "0")}:${String(dl.minute).padStart(2, "0")}`;
    log(`ALERT create deadline ${hhmm} ET missed for ${dateKey} — incomplete: ${gaps.join("; ")} (no price / failed creates retry every tick until 16:00 ET)`);
    opts.state.lastDeadlineAlertKey = dateKey;
  };
  if (opts.state.lastCreateDateKey === dateKey) {
    log(`skip create — already ran for ${dateKey}`);
    deadlineAlert(opts.state.dayGaps?.dateKey === dateKey ? opts.state.dayGaps.gaps : []);
    return [];
  }
  if (!opts.cfg.collateralMint) {
    throw new Error("COLLATERAL_MINT required for create_strike_market");
  }
  if (opts.state.dayPlan?.dateKey !== dateKey) opts.state.dayPlan = { dateKey, strikes: {} };
  const dayPlan = opts.state.dayPlan;

  // Idempotency: what already exists on-chain for today's close (restarts, retries, another creator).
  const haveStrike = new Set<string>();
  const haveCount: Record<string, number> = {};
  try {
    const open = await (opts.listOpen ? opts.listOpen() : fetchOpenMarkets(opts.program));
    for (const m of open) {
      const exp = Number(m.account.expiryTs?.toString?.() ?? m.account.expiry_ts ?? 0);
      if (exp !== closeTs) continue;
      const sym = decodeEquitySymbol(m.account.equitySymbol ?? m.account.equity_symbol ?? []);
      const strike = String(m.account.strikePriceE6?.toString?.() ?? m.account.strike_price_e6 ?? "");
      haveStrike.add(`${sym}:${strike}`);
      haveCount[sym] = (haveCount[sym] ?? 0) + 1;
    }
  } catch (e) {
    log(`ALERT open-market scan failed — not creating this tick (no blind create, L-1); retrying: ${String(e).slice(0, 160)}`);
    return [];
  }

  const conn = (opts.program as any)?.provider?.connection;
  const readAccount: ReadAccount | undefined =
    opts.readAccount ??
    (conn?.getAccountInfo
      ? async (pk: PublicKey) => {
          const a = await conn.getAccountInfo(pk, "confirmed");
          return a ? { data: a.data as Buffer, owner: a.owner as PublicKey } : null;
        }
      : undefined);
  const operator = loadOperatorDayPrices(opts.cfg, "strike");
  const step = (ref: bigint) => opts.cfg.strikeStepE6 ?? defaultStrikeStepE6(ref);
  const toCreate: StrikeSpec[] = [];
  let missingPrice = 0;
  // Review M1: why the day is incomplete. `persistent` = not retried (config / partial set); `retried` = this pass only.
  const persistent: string[] = [];
  const retried: string[] = [];
  for (const symbol of opts.cfg.symbols) {
    // D-025: off-localnet a market with a zero feed id can never permissionless-settle.
    if (opts.cfg.cluster !== "localnet" && !opts.cfg.pythFeedIds[symbol]) {
      log(`skip ${symbol} — missing PYTH_FEED_IDS entry (required off-localnet, D-025)`);
      persistent.push(`${symbol} missing PYTH_FEED_IDS`);
      continue;
    }
    if (!opts.cfg.pythPriceFeeds[symbol]) {
      log(`skip ${symbol} — missing PYTH_PRICE_FEEDS entry`);
      persistent.push(`${symbol} missing PYTH_PRICE_FEEDS`);
      continue;
    }
    let strikes = dayPlan.strikes[symbol];
    if (!strikes) {
      if (haveCount[symbol]) {
        // Created before this process knew the plan (restart / other creator): never add a second set.
        const n = haveCount[symbol];
        log(`${n < opts.cfg.strikeOffsetsE6.length ? "ALERT " : ""}skip ${symbol} — already has ${n} market(s) expiring ${dateKey} 16:00 ET${n < opts.cfg.strikeOffsetsE6.length ? ` (fewer than the ${opts.cfg.strikeOffsetsE6.length} planned; not completing without the original plan)` : ""}`);
        if (n < opts.cfg.strikeOffsetsE6.length) persistent.push(`${symbol} has ${n}/${opts.cfg.strikeOffsetsE6.length} markets`);
        continue;
      }
      const d = await strikeReferenceFor(opts.cfg, symbol, dateKey, operator, opts.hermesAt, readAccount);
      if (!d.ok) {
        missingPrice++;
        retried.push(`${symbol} no prior-close price`);
        // Review N3: ALERT once per symbol per ET day; later ticks log a plain retry line.
        const seen = (opts.state.refAlertDay ??= {});
        if (seen[symbol] !== dateKey) {
          log(`ALERT no prior-close strike reference for ${symbol} on ${dateKey} — not created: ${d.reason}`);
          seen[symbol] = dateKey;
        } else log(`no prior-close strike reference for ${symbol} on ${dateKey} — retrying next tick: ${d.reason}`);
        continue;
      }
      log(`strike reference ${symbol} ${d.priceE6} (${d.source})`);
      strikes = atmStrikesE6(d.priceE6, opts.cfg.strikeOffsetsE6, step(d.priceE6)).map(String);
      dayPlan.strikes[symbol] = strikes;
    }
    for (const strikeE6 of strikes) {
      if (haveStrike.has(`${symbol}:${strikeE6}`)) continue;
      toCreate.push({
        symbol,
        equitySymbol: encodeEquitySymbol(symbol),
        strikePriceE6: new BN(strikeE6),
        expiryTs: new BN(closeTs),
        pythFeedId: opts.cfg.pythFeedIds[symbol] ?? Buffer.alloc(32, 0),
        phoenixMarket: PublicKey.default, // L-8
      });
    }
  }

  const created: TrackedMarket[] = [];
  let failed = 0;
  for (const strike of toCreate) {
    const feed = opts.cfg.pythPriceFeeds[strike.symbol];
    try {
      const { market, signature } = opts.create
        ? await opts.create(strike)
        : await createStrikeMarket({ program: opts.program, authority: opts.authority, collateralMint: opts.cfg.collateralMint, pythPriceFeed: feed, strike });
      log(`created market`, { market: market.toBase58(), sig: signature, symbol: strike.symbol, strikeE6: strike.strikePriceE6.toString(), expiryTs: closeTs });
      if (!opts.create) log(`phoenix book create TODO — no book bound for ${strike.symbol} (L-8: PHOENIX_MARKETS not used for daily markets)`);
      const tracked: TrackedMarket = { market, symbol: strike.symbol, pythPriceFeed: feed, expiryTs: closeTs, settleAttempts: 0, createdDateKey: dateKey };
      opts.state.tracked.push(tracked);
      created.push(tracked);
      retried.push(`${strike.symbol}@${strike.strikePriceE6.toString()} created only now`);
    } catch (e) {
      failed++;
      retried.push(`${strike.symbol}@${strike.strikePriceE6.toString()} create failed`);
      log(`ALERT create failed for ${strike.symbol}@${strike.strikePriceE6.toString()} (day stays open; retry next tick, L-3): ${String(e).split("\n")[0].slice(0, 200)}`);
    }
  }

  // Missing price or failed create → leave the day open so the next tick retries (idempotent: existing strikes skip).
  if (missingPrice === 0 && failed === 0) {
    opts.state.lastCreateDateKey = dateKey;
    opts.state.dayGaps = { dateKey, gaps: persistent };
  }
  deadlineAlert([...persistent, ...retried]);
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
      // L-5: localnet AND a loopback RPC (config also refuses localnet on a real RPC) — never an unsourced price on devnet.
      if (opts.cfg.cluster === "localnet" && isLoopbackRpc(opts.cfg.rpcUrl) && !day && opts.cfg.adminSettlePriceE6 !== null && opts.cfg.adminSettleOutcomeYes !== null) {
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
