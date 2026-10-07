/**
 * Calendar mode (prod/devnet/Railway): morning create + post-16:00 ET settle with real Pyth.
 * Must NOT import sim helpers or localnet fixture ixs.
 */
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { AutomationConfig } from "../config";
import {
  assertSettleAllowedCalendar,
  expiryTsForEtClose,
  getEtParts,
  isCreateWindow,
} from "../schedule";
import { buildStrikes, StrikeSpec } from "../strikes";
import {
  adminSettleMarket,
  createStrikeMarket,
  fetchOpenMarkets,
  MarketStatus,
  setPhoenixMarket,
  settleMarket,
} from "../solana/instructions";

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

export function planMorningStrikes(cfg: AutomationConfig, now: Date = new Date()): StrikeSpec[] {
  const expiryTs = expiryTsForEtClose(now, cfg.settleHourEt);
  return buildStrikes({
    symbols: cfg.symbols,
    priorCloseE6: cfg.priorCloseE6,
    offsetsE6: cfg.strikeOffsetsE6,
    expiryTs,
    feedIds: cfg.pythFeedIds,
    phoenixMarkets: cfg.phoenixMarkets,
  });
}

/**
 * Morning strike creation (~CREATE_HOUR_ET America/New_York).
 * Idempotent per ET calendar day via lastCreateDateKey.
 */
export async function runMorningCreate(opts: {
  cfg: AutomationConfig;
  program: Program;
  authority: Keypair;
  state: CalendarState;
  now?: Date;
}): Promise<TrackedMarket[]> {
  const now = opts.now ?? new Date();
  const parts = getEtParts(now);
  if (!isCreateWindow(now, opts.cfg.createHourEt)) {
    log(`skip create — not in hour ${opts.cfg.createHourEt} ET (now ${parts.hour}:${parts.minute})`);
    return [];
  }
  if (opts.state.lastCreateDateKey === parts.dateKey) {
    log(`skip create — already ran for ${parts.dateKey}`);
    return [];
  }
  if (!opts.cfg.collateralMint) {
    throw new Error("COLLATERAL_MINT required for create_strike_market");
  }

  const strikes = planMorningStrikes(opts.cfg, now);
  const created: TrackedMarket[] = [];

  for (const strike of strikes) {
    const feed = opts.cfg.pythPriceFeeds[strike.symbol];
    if (!feed) {
      log(`skip ${strike.symbol} — missing PYTH_PRICE_FEEDS entry`);
      continue;
    }
    try {
      const { market, signature } = await createStrikeMarket({
        program: opts.program,
        authority: opts.authority,
        collateralMint: opts.cfg.collateralMint,
        pythPriceFeed: feed,
        strike,
      });
      log(`created market`, { market: market.toBase58(), sig: signature, symbol: strike.symbol });

      const phoenix = opts.cfg.phoenixMarkets[strike.symbol];
      if (phoenix && !phoenix.equals(PublicKey.default)) {
        // Phoenix market *create* stubbed — wiring only when pubkey provided.
        const sig2 = await setPhoenixMarket({
          program: opts.program,
          authority: opts.authority,
          market,
          phoenixMarket: phoenix,
        });
        log(`set_phoenix_market`, { market: market.toBase58(), phoenix: phoenix.toBase58(), sig: sig2 });
      } else {
        log(`phoenix create TODO — no PHOENIX_MARKETS.${strike.symbol}; skipped set_phoenix_market`);
      }

      const tracked: TrackedMarket = {
        market,
        symbol: strike.symbol,
        pythPriceFeed: feed,
        expiryTs: Number(strike.expiryTs.toString()),
        settleAttempts: 0,
        createdDateKey: parts.dateKey,
      };
      opts.state.tracked.push(tracked);
      created.push(tracked);
    } catch (e) {
      log(`create failed for ${strike.symbol}@${strike.strikePriceE6.toString()}: ${e}`);
    }
  }

  opts.state.lastCreateDateKey = parts.dateKey;
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
  state: CalendarState;
  now?: Date;
}): Promise<void> {
  const now = opts.now ?? new Date();
  try {
    assertSettleAllowedCalendar(now, opts.cfg.settleHourEt);
  } catch (e) {
    log(String(e));
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
    try {
      const sig = await settleMarket({
        program: opts.program,
        settler: opts.authority,
        market: tracked.market,
        pythPriceFeed: tracked.pythPriceFeed,
      });
      log(`settled`, { market: tracked.market.toBase58(), sig, attempts: tracked.settleAttempts });
      tracked.settleAttempts = 0;
      continue;
    } catch (e) {
      log(`settle retry failed`, {
        market: tracked.market.toBase58(),
        attempts: tracked.settleAttempts,
        err: String(e),
      });
    }

    if (
      tracked.settleAttempts >= opts.cfg.adminSettleAfterRetries &&
      opts.cfg.adminSettlePriceE6 !== null &&
      opts.cfg.adminSettleOutcomeYes !== null
    ) {
      // admin_settle: on-chain enforces expiry + admin_settle_delay_secs.
      try {
        const sig = await adminSettleMarket({
          program: opts.program,
          authority: opts.authority,
          market: tracked.market,
          settlementPriceE6: new BN(opts.cfg.adminSettlePriceE6.toString()),
          outcomeYes: opts.cfg.adminSettleOutcomeYes,
        });
        log(`admin_settle`, { market: tracked.market.toBase58(), sig });
      } catch (e) {
        log(`admin_settle failed (delay may remain): ${e}`);
      }
    }
  }

  void MarketStatus;
}
