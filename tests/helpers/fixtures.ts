/**
 * Shared fixtures for Meridian TDD (docs/TEST_MATRIX.md "Shared fixtures").
 *
 * Phoenix: pubkey + mint-wiring asserts only — NO matching engine (D-002, D-015, SCHEMA §7.7).
 * Pyth: placeholder price-account fixtures; Engineers pin MAG7 feed ids later.
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/**
 * Current program id (post !24 rotate). Must match `declare_id!`,
 * `Anchor.toml` `[programs.localnet]`, and IDL `address`.
 * Deploy keypair is **gitignored** (`keys/meridian-keypair.json` /
 * `target/deploy/meridian-keypair.json`) — generate locally per
 * [`keys/README.md`](../../keys/README.md); never commit secret bytes.
 * Revoked (do not use): GwTvo6yNrGc8FS8cRYi1wbqcynVyWgkQssZ2vyYnxxo2
 */
export const MERIDIAN_PROGRAM_ID = new PublicKey(
  "9Rb7nxTRRQg2F3qWiDhnQ1dTjDoTvRimcyykLfhwG9r6"
);

export const PRICE_SCALE = 1_000_000;
export const COLLATERAL_DECIMALS = 6;

/** $180.00 strike in PRICE_SCALE */
export const DEFAULT_STRIKE_E6 = new BN(180_000_000);

/** Space-padded AAPL → 8 bytes */
export const EQUITY_AAPL = Buffer.from("AAPL    ");

export const DEFAULT_STALENESS_SLOTS = 150;
export const DEFAULT_CONF_RATIO_BPS = 500;
export const DEFAULT_ADMIN_SETTLE_DELAY_SECS = 1800;

/** Fee defaults (D-006) */
export const DEFAULT_MINT_FEE_BPS = 0;
export const DEFAULT_REDEEM_FEE_BPS = 0;

/** One full outcome token / $1 USDC raw */
export const ONE = new BN(1_000_000);

/** Deterministic placeholders so tests don't depend on keygen. */
export const PYTH_PRICE_FEED_PLACEHOLDER = new PublicKey(
  Buffer.alloc(32, 0x91)
);
export const PYTH_FEED_ID_PLACEHOLDER = Buffer.alloc(32, 0x42);

/**
 * Phoenix market placeholder pubkey. Meridian stores linkage only;
 * place/cancel/fill are out of scope for these tests (SCHEMA §2, §7.7).
 */
export const PHOENIX_MARKET_PLACEHOLDER = new PublicKey(
  Buffer.alloc(32, 0x50)
);

/** Settling=1 retired/unused (D-018 / X-07); discriminant kept for layout. */
export const MarketStatus = {
  Open: 0,
  Settling: 1,
  SettledYes: 2,
  SettledNo: 3,
  Void: 4,
} as const;

/** units.md §8 vectors for S-10 */
export const PYTH_TO_E6_VECTORS: Array<{
  price: bigint;
  expo: number;
  expectedE6: bigint;
  note: string;
}> = [
  {
    price: 18_000_000_000n,
    expo: -8,
    expectedE6: 180_000_000n,
    note: "$180.00",
  },
  {
    price: 18_050_000_000n,
    expo: -8,
    expectedE6: 180_500_000n,
    note: "$180.50",
  },
  {
    price: 180_000_000n,
    expo: -6,
    expectedE6: 180_000_000n,
    note: "expo -6 passthrough",
  },
  {
    price: 1n,
    expo: -8,
    expectedE6: 0n,
    note: "truncates to 0 — reject as InvalidPythPrice",
  },
];

/**
 * Localnet simulated session (D-017 / Cluster G).
 * Engineers may expose `trading_open: bool` on StrikeMarket instead of a new status.
 * TradingClosed listed for status-machine option only — prefer bool to avoid breaking Open settle gates.
 */
export const SIM_SESSION_FEATURE = "localnet-test" as const;

/** Suggested Anchor error codes for sim session (pin in impl). */
export const SimError = {
  TradingClosed: "TradingClosed",
  SessionNotClosed: "SessionNotClosed",
} as const;

/** Suggested localnet-only instruction names (cfg feature = localnet-test). */
export const SIM_SESSION_INSTRUCTIONS = [
  "sim_open_session",
  "sim_close_session",
] as const;
