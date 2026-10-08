/**
 * Automation env config (DEPLOY.md §4).
 * Secrets via env / Railway Variables only — never commit keypairs.
 */
import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

import { MAG7 } from "./marketDay";

export type AutomationMode = "calendar" | "sim";
export type SolanaCluster = "localnet" | "devnet" | "mainnet-beta";

export const DEFAULT_PROGRAM_ID = "9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6";
export const ET_TZ = "America/New_York";

/** Fixture / localnet-only instruction names that must never appear on prod IDL path. */
export const FIXTURE_IX_NAMES = [
  "upsert_mock_pyth",
  "upsertMockPyth",
  "sim_open_session",
  "simOpenSession",
  "sim_close_session",
  "simCloseSession",
  "test_drain_vault",
  "testDrainVault",
  "init_sim_clock",
  "set_sim_clock",
  "warp_sim_clock",
  "disable_sim_clock",
] as const;

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env ${name}`);
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function parseJsonMap(raw: string): Record<string, string> {
  if (!raw || raw.trim() === "") return {};
  try {
    const o = JSON.parse(raw);
    if (typeof o !== "object" || o === null || Array.isArray(o)) {
      throw new Error("expected object");
    }
    return o as Record<string, string>;
  } catch (e) {
    throw new Error(`Invalid JSON map: ${e}`);
  }
}

function parseIntList(raw: string, fallback: number[]): number[] {
  if (!raw || !raw.trim()) return fallback;
  return raw.split(",").map((s) => {
    const n = Number(s.trim());
    if (!Number.isFinite(n)) throw new Error(`Invalid number in list: ${s}`);
    return n;
  });
}

function parseSymbols(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Load keypair from JSON file path or JSON byte-array string (Railway secret). */
export function loadKeypairFromEnv(raw: string): Keypair {
  if (!raw) throw new Error("AUTOMATION_KEYPAIR is empty");
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(data));
  }
  // Treat as filesystem path to a solana-keygen JSON array.
  const abs = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `AUTOMATION_KEYPAIR path not found: ${abs}. Use a JSON file path or inline JSON byte array.`
    );
  }
  const data = JSON.parse(fs.readFileSync(abs, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

export interface AutomationConfig {
  mode: AutomationMode;
  rpcUrl: string;
  cluster: SolanaCluster;
  programId: PublicKey;
  idlPath: string;
  /** Loaded lazily when needed for txs; may be undefined for dry unit tests. */
  keypairRaw: string;
  /**
   * M3: separate low-balance key that signs + pays for permissionless `settle` (and Pyth posts).
   * Never the config authority. Required on mainnet-beta; devnet/localnet fall back to the
   * authority with a warning when unset.
   */
  settlerKeypairRaw: string;
  /**
   * Review dd46769: dedicated key that is each Phoenix book's seat-manager authority (after the PSM
   * handoff) and pauses books at expiry. NOT low-privilege (review mr72-73 M1): the SM authority can
   * also unpause, move/burn the SM authority and hand the Phoenix market authority away. Never the upgrade key, the config authority
   * or the settler. Unset → pausing disabled (warned) off mainnet; required on mainnet-beta.
   */
  pauserKeypairRaw: string;
  /** Pause this many seconds before expiry (default 0 = at expiry). */
  pauseLeadSecs: number;
  /** Missed-pause alert threshold after expiry (default 120 s). */
  pauseAlertSecs: number;
  /** Reviewers !78 N-2: repeat interval for a standing pause ALERT per book / reason (default 3600 s). */
  pauseAlertRepeatSecs: number;
  collateralMint: PublicKey | null;
  symbols: string[];
  priorCloseE6: bigint;
  strikeOffsetsE6: number[];
  /** D-026: earliest ET wall time the calendar worker creates the day's markets (CREATE_FROM_ET, default 07:00). */
  createFromEt: EtHourMinute;
  /** D-026: the day's markets must all exist by this ET time (CREATE_DEADLINE_ET, default 08:00) — else ALERT once. */
  createDeadlineEt: EtHourMinute;
  settleHourEt: number;
  pythPriceFeeds: Record<string, PublicKey>;
  pythFeedIds: Record<string, Buffer>;
  phoenixMarkets: Record<string, PublicKey>;
  settlePollMs: number;
  settleMaxRetries: number;
  adminSettleAfterRetries: number;
  adminSettlePriceE6: bigint | null;
  adminSettleOutcomeYes: boolean | null;
  workerTickMs: number;
  logLevel: string;
  /** D-025: Hermes base URL for pull-oracle settle prices. */
  pythHermesUrl: string;
  /** D-025: Hermes API key (Bearer). Required off-localnet for permissionless settle since 2026-08-26. */
  pythHermesApiKey: string | undefined;
  /** DLV-118: strike rounding step (micro-USD); null → $5 at/above $100, else $1. */
  strikeStepE6: bigint | null;
  /**
   * D-026: a Pyth price (Hermes or the sponsored PriceUpdateV2) is the strike reference only if its publish_time is in
   * [prior close, prior close + PRIOR_CLOSE_MAX_SKEW_SECS] (default 300, range 10..900).
   */
  priorCloseMaxSkewSecs: number;
  /**
   * DLV-118 / D-026: operator-sourced prices (JSON {dateKey, source, pricesE6:{SYM:"<micro-USD>"}}), inline or a file
   * path read at use time. `strike` = the previous trading day's official closes for market day `dateKey` (optional
   * `closeDateKey` = that previous day); `close` = admin_settle price at the close.
   * Used while Hermes is 403 for equity feeds (DLV-106); a valid Hermes price always wins.
   */
  operatorStrikePricesRaw: string;
  operatorStrikePricesFile: string;
  operatorClosePricesRaw: string;
  operatorClosePricesFile: string;
}

export interface EtHourMinute {
  hour: number;
  minute: number;
}

/** D-026: "HH:MM" (24 h, ET wall clock) → { hour, minute }; throws with the variable name on anything else. */
export function parseEtHhMm(name: string, raw: string | undefined, def: string): EtHourMinute {
  const t = (raw === undefined || raw.trim() === "" ? def : raw).trim();
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(t);
  if (!m) throw new Error(`${name} must be HH:MM (24 h, America/New_York), e.g. ${def} (got ${JSON.stringify(raw)})`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function resolveIdlPath(raw: string): string {
  if (path.isAbsolute(raw)) return raw;
  // Prefer packaged path (apps/automation/idl) then monorepo root idl/.
  const stripped = raw.replace(/^\.\.\/\.\.\//, "");
  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), "idl", path.basename(raw)),
    path.resolve(__dirname, "..", "idl", path.basename(raw)), // dist/ -> ../idl
    path.resolve(process.cwd(), "..", "..", stripped),
    path.resolve(__dirname, "../../..", stripped),
    path.resolve(__dirname, "../../../idl", path.basename(raw)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), raw);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AutomationConfig {
  const mode = (env.MODE ?? "calendar").toLowerCase() as AutomationMode;
  if (mode !== "calendar" && mode !== "sim") {
    throw new Error(`MODE must be calendar|sim, got ${mode}`);
  }
  const cluster = (env.SOLANA_CLUSTER ?? "devnet") as SolanaCluster;
  if (!["localnet", "devnet", "mainnet-beta"].includes(cluster)) {
    throw new Error(`SOLANA_CLUSTER invalid: ${cluster}`);
  }
  if (mode === "sim" && cluster !== "localnet") {
    throw new Error("MODE=sim is localnet-only (D-017). Refusing non-localnet cluster.");
  }
  if (env.ANCHOR_FEATURES === "localnet-test" && cluster !== "localnet") {
    throw new Error("ANCHOR_FEATURES=localnet-test is forbidden off localnet (DEPLOY.md §2).");
  }

  // Packaged IDL for Railway rootDirectory=apps/automation (baked under idl/).
  // Local monorepo still resolves ../../idl/... via resolveIdlPath candidates.
  const defaultIdl =
    cluster === "localnet" && mode === "sim"
      ? "../../idl/meridian.json"
      : "idl/meridian.prod.json";

  const idlPath = resolveIdlPath(env.MERIDIAN_IDL_PATH ?? defaultIdl);

  const pythRaw = parseJsonMap(env.PYTH_PRICE_FEEDS ?? "{}");
  const pythPriceFeeds: Record<string, PublicKey> = {};
  for (const [k, v] of Object.entries(pythRaw)) {
    pythPriceFeeds[k.toUpperCase()] = new PublicKey(v);
  }

  const feedIdRaw = parseJsonMap(env.PYTH_FEED_IDS ?? "{}");
  const pythFeedIds: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(feedIdRaw)) {
    const hex = v.replace(/^0x/, "");
    if (hex.length !== 64) throw new Error(`PYTH_FEED_IDS.${k} must be 32 bytes hex`);
    pythFeedIds[k.toUpperCase()] = Buffer.from(hex, "hex");
  }

  const phoenixRaw = parseJsonMap(env.PHOENIX_MARKETS ?? "{}");
  const phoenixMarkets: Record<string, PublicKey> = {};
  for (const [k, v] of Object.entries(phoenixRaw)) {
    phoenixMarkets[k.toUpperCase()] = new PublicKey(v);
  }

  const collateral = opt("COLLATERAL_MINT", env.COLLATERAL_MINT ?? "");

  // DLV-119 / Reviewers L-5: "localnet" unlocks dev-only paths (static admin price, zero feed ids), so it must also
  // point at a loopback RPC — a mis-set SOLANA_CLUSTER=localnet on a real RPC refuses to start.
  const rpcUrl = req("SOLANA_RPC_URL", env.SOLANA_RPC_URL ?? (cluster === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com"));
  if (cluster === "localnet" && !isLoopbackRpc(rpcUrl)) {
    throw new Error(`SOLANA_CLUSTER=localnet requires a loopback SOLANA_RPC_URL (127.0.0.1 / localhost / ::1); got a non-loopback host`);
  }
  // D-026: create window [CREATE_FROM_ET, 16:00) ET; deadline CREATE_DEADLINE_ET. from <= deadline < 16:00 ET close.
  const createFromEt = parseEtHhMm("CREATE_FROM_ET", env.CREATE_FROM_ET, "07:00");
  const createDeadlineEt = parseEtHhMm("CREATE_DEADLINE_ET", env.CREATE_DEADLINE_ET, "08:00");
  const mins = (x: EtHourMinute) => x.hour * 60 + x.minute;
  if (mins(createFromEt) >= 16 * 60) throw new Error("CREATE_FROM_ET must be before the 16:00 ET close");
  if (mins(createDeadlineEt) >= 16 * 60) throw new Error("CREATE_DEADLINE_ET must be before the 16:00 ET close");
  if (mins(createFromEt) > mins(createDeadlineEt)) throw new Error("CREATE_FROM_ET must not be after CREATE_DEADLINE_ET");
  // Nit (Reviewers !91): validate the strike step at load, not mid-create.
  let strikeStepE6: bigint | null = null;
  if (env.STRIKE_STEP_E6 !== undefined && env.STRIKE_STEP_E6.trim() !== "") {
    if (!/^[1-9][0-9]*$/.test(env.STRIKE_STEP_E6.trim())) throw new Error("STRIKE_STEP_E6 must be a positive integer (micro-USD), e.g. 5000000");
    strikeStepE6 = BigInt(env.STRIKE_STEP_E6.trim());
  }

  return {
    mode,
    rpcUrl,
    cluster,
    programId: new PublicKey(env.MERIDIAN_PROGRAM_ID ?? DEFAULT_PROGRAM_ID),
    idlPath,
    keypairRaw: env.AUTOMATION_KEYPAIR ?? "",
    settlerKeypairRaw: env.SETTLER_KEYPAIR ?? "",
    pauserKeypairRaw: env.PHOENIX_PAUSER_KEYPAIR ?? "",
    pauseLeadSecs: intInRange("PHOENIX_PAUSE_LEAD_SECS", env.PHOENIX_PAUSE_LEAD_SECS, 0, 0, 300),
    pauseAlertSecs: intInRange("PHOENIX_PAUSE_ALERT_SECS", env.PHOENIX_PAUSE_ALERT_SECS, 120, 10, 86_400),
    pauseAlertRepeatSecs: intInRange("PHOENIX_PAUSE_ALERT_REPEAT_SECS", env.PHOENIX_PAUSE_ALERT_REPEAT_SECS, 3600, 60, 86_400),
    collateralMint: collateral ? new PublicKey(collateral) : null,
    symbols: parseSymbols(env.STRIKE_SYMBOLS ?? MAG7.join(",")).map((s) => s.toUpperCase()),
    priorCloseE6: BigInt(env.PRIOR_CLOSE_E6 ?? "180000000"),
    strikeOffsetsE6: parseIntList(env.STRIKE_OFFSETS_E6 ?? "-5000000,0,5000000", [
      -5_000_000, 0, 5_000_000,
    ]),
    createFromEt,
    createDeadlineEt,
    settleHourEt: Number(env.SETTLE_HOUR_ET ?? "16"),
    pythPriceFeeds,
    pythFeedIds,
    phoenixMarkets,
    settlePollMs: Number(env.SETTLE_POLL_MS ?? "30000"),
    settleMaxRetries: Number(env.SETTLE_MAX_RETRIES ?? "40"),
    adminSettleAfterRetries: Number(env.ADMIN_SETTLE_AFTER_RETRIES ?? "20"),
    adminSettlePriceE6: env.ADMIN_SETTLE_PRICE_E6
      ? BigInt(env.ADMIN_SETTLE_PRICE_E6)
      : null,
    adminSettleOutcomeYes:
      env.ADMIN_SETTLE_OUTCOME_YES === undefined || env.ADMIN_SETTLE_OUTCOME_YES === ""
        ? null
        : env.ADMIN_SETTLE_OUTCOME_YES === "true" || env.ADMIN_SETTLE_OUTCOME_YES === "1",
    workerTickMs: Number(env.WORKER_TICK_MS ?? "60000"),
    logLevel: env.LOG_LEVEL ?? "info",
    pythHermesUrl: env.PYTH_HERMES_URL || "https://hermes.pyth.network",
    pythHermesApiKey: env.PYTH_HERMES_API_KEY || undefined,
    strikeStepE6,
    priorCloseMaxSkewSecs: intInRange("PRIOR_CLOSE_MAX_SKEW_SECS", env.PRIOR_CLOSE_MAX_SKEW_SECS, 300, 10, 900),
    operatorStrikePricesRaw: env.OPERATOR_STRIKE_PRICES ?? "",
    operatorStrikePricesFile: env.OPERATOR_STRIKE_PRICES_FILE ?? "",
    operatorClosePricesRaw: env.OPERATOR_CLOSE_PRICES ?? "",
    operatorClosePricesFile: env.OPERATOR_CLOSE_PRICES_FILE ?? "",
  };
}

/**
 * L1 (review mr72-73): pause timing must be a plain integer in range. `Number("5s")` is NaN, and
 * `now < expiry − NaN` is false, so a typo used to pause every book immediately. Throw at startup.
 */
function intInRange(name: string, raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined) return def;
  const t = raw.trim();
  if (!/^-?[0-9]+$/.test(t) || Number(t) < min || Number(t) > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}] seconds (got ${JSON.stringify(raw)})`);
  }
  return Number(t);
}

/**
 * L5 (review mr72-73): the ops-cli pause / handoff paths refuse a pauser equal to the config authority,
 * the settler, the current seat-manager authority / upgrade key (handoff target must be a NEW key) or
 * any pubkey in PAUSER_MUST_DIFFER_FROM (comma list; pubkeys only, so the upgrade key never has to be
 * loaded just for this check).
 */
export function assertPauserDistinct(
  pauser: PublicKey,
  env: Record<string, string | undefined>,
  opts: { checkSeatManagerAuthority?: boolean } = {},
): void {
  const keyVars = ["AUTOMATION_KEYPAIR", "SETTLER_KEYPAIR", ...(opts.checkSeatManagerAuthority ? ["SEAT_MANAGER_AUTHORITY_KEYPAIR"] : [])];
  for (const v of keyVars) {
    const raw = env[v];
    if (raw && loadKeypairFromEnv(raw).publicKey.equals(pauser)) throw new Error(`PHOENIX_PAUSER_KEYPAIR must differ from ${v}`);
  }
  for (const pk of (env.PAUSER_MUST_DIFFER_FROM ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (new PublicKey(pk).equals(pauser)) throw new Error(`PHOENIX_PAUSER_KEYPAIR must differ from PAUSER_MUST_DIFFER_FROM (${pk})`);
  }
}

export function loadKeypair(cfg: AutomationConfig): Keypair {
  return loadKeypairFromEnv(cfg.keypairRaw);
}

export interface ResolvedSettler {
  keypair: Keypair;
  /** false = authority fallback (SETTLER_KEYPAIR unset on devnet/localnet) */
  separate: boolean;
}

/**
 * M3 (Reviewers, !57): permissionless settle is signed and paid by SETTLER_KEYPAIR, a low-balance
 * key that can't pause, update_config or admin_settle. `settle` has no authority constraint on
 * chain (any signer), so this needs no program change.
 */
export function resolveSettler(cfg: AutomationConfig, authority: Keypair): ResolvedSettler {
  if (!cfg.settlerKeypairRaw) {
    if (cfg.cluster === "mainnet-beta") {
      throw new Error("SETTLER_KEYPAIR required on mainnet-beta (M3: settle must not use the config authority)");
    }
    return { keypair: authority, separate: false };
  }
  const keypair = loadKeypairFromEnv(cfg.settlerKeypairRaw);
  if (keypair.publicKey.equals(authority.publicKey)) {
    throw new Error("SETTLER_KEYPAIR must differ from AUTOMATION_KEYPAIR (the config authority)");
  }
  return { keypair, separate: true };
}

/**
 * Review dd46769: the Phoenix pauser (per-book seat-manager authority). Refuses the config authority
 * and the settler so each key keeps one job. Returns null when unset off mainnet (pausing disabled).
 */
export function resolvePauser(cfg: AutomationConfig, authority: Keypair, settler?: Keypair): Keypair | null {
  if (!cfg.pauserKeypairRaw) {
    if (cfg.cluster === "mainnet-beta") {
      throw new Error("PHOENIX_PAUSER_KEYPAIR required on mainnet-beta (Phoenix books must pause at expiry)");
    }
    return null;
  }
  const kp = loadKeypairFromEnv(cfg.pauserKeypairRaw);
  if (kp.publicKey.equals(authority.publicKey)) {
    throw new Error("PHOENIX_PAUSER_KEYPAIR must differ from AUTOMATION_KEYPAIR (the config authority)");
  }
  if (settler && kp.publicKey.equals(settler.publicKey)) {
    throw new Error("PHOENIX_PAUSER_KEYPAIR must differ from SETTLER_KEYPAIR");
  }
  return kp;
}

/** True for 127.0.0.0/8, localhost and ::1 RPC URLs (DLV-119 L-5). */
export function isLoopbackRpc(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}
