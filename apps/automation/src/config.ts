/**
 * Automation env config (DEPLOY.md §4).
 * Secrets via env / Railway Variables only — never commit keypairs.
 */
import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

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
  collateralMint: PublicKey | null;
  symbols: string[];
  priorCloseE6: bigint;
  strikeOffsetsE6: number[];
  createHourEt: number;
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

  return {
    mode,
    rpcUrl: req("SOLANA_RPC_URL", env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com"),
    cluster,
    programId: new PublicKey(env.MERIDIAN_PROGRAM_ID ?? DEFAULT_PROGRAM_ID),
    idlPath,
    keypairRaw: env.AUTOMATION_KEYPAIR ?? "",
    settlerKeypairRaw: env.SETTLER_KEYPAIR ?? "",
    collateralMint: collateral ? new PublicKey(collateral) : null,
    symbols: parseSymbols(env.STRIKE_SYMBOLS ?? "AAPL").map((s) => s.toUpperCase()),
    priorCloseE6: BigInt(env.PRIOR_CLOSE_E6 ?? "180000000"),
    strikeOffsetsE6: parseIntList(env.STRIKE_OFFSETS_E6 ?? "-5000000,0,5000000", [
      -5_000_000, 0, 5_000_000,
    ]),
    createHourEt: Number(env.CREATE_HOUR_ET ?? "8"),
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
  };
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
