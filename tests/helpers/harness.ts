/**
 * TDD harness — plugs into Anchor once Engineers add programs/meridian sources.
 *
 * Until the program binary + real IDL exist, every integration path throws
 * `TDD_RED` so mocha cases fail loudly (D-016). Unit tests (S-10) may run
 * against a pure TS mirror of units.md once Engineers expose pyth_price_to_e6;
 * for now the mirror is intentionally absent → also red.
 *
 * Phoenix: mock pubkey only. Pyth: placeholder accounts. No matching engine.
 */
import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { MERIDIAN_PROGRAM_ID } from "./fixtures";

export class TddRedError extends Error {
  readonly code = "TDD_RED";
  constructor(caseId: string, detail: string) {
    super(
      `[TDD_RED ${caseId}] ${detail} — Engineers: implement only enough program code to green this case (D-016). See docs/TEST_MATRIX.md.`
    );
    this.name = "TddRedError";
  }
}

/** Expected SCHEMA §5 instruction names (must stay in sync with stub IDL). */
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
  // tests/helpers → repo root
  return path.resolve(__dirname, "../..");
}

/** Load stub (or future generated) IDL; assert SCHEMA instruction names present. */
export function loadMeridianIdl(): { address: string; instructions: { name: string }[] } {
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
  throw new TddRedError(
    "IDL",
    `meridian IDL not found (looked in target/idl/, idl/). Program scaffold missing.`
  );
}

export function assertIdlHasInstructions(caseId: string = "IDL") {
  const idl = loadMeridianIdl();
  const names = new Set(idl.instructions.map((i) => i.name));
  for (const ix of EXPECTED_INSTRUCTIONS) {
    expect(names.has(ix), `${caseId}: IDL missing instruction '${ix}' (SCHEMA §5)`).to
      .equal(true);
  }
  expect(idl.address).to.equal(MERIDIAN_PROGRAM_ID.toBase58());
}

/**
 * Require a live Anchor Program client. Fails until Engineers land:
 * Anchor.toml workspace + programs/meridian sources + build artifacts.
 */
export function requireProgram(caseId: string): never {
  // Detect whether real program sources exist (not just README scaffold map).
  const root = findRepoRoot();
  const libRs = path.join(root, "programs/meridian/src/lib.rs");
  const cargo = path.join(root, "programs/meridian/Cargo.toml");
  if (!fs.existsSync(libRs) || !fs.existsSync(cargo)) {
    throw new TddRedError(
      caseId,
      "programs/meridian Anchor sources missing (need Cargo.toml + src/lib.rs). " +
        "Integration tests intentionally fail until Engineers scaffold + implement."
    );
  }
  // Sources exist but we still need a deployed/local program + provider.
  // Keep red until a real client can be constructed (Engineers wire this).
  throw new TddRedError(
    caseId,
    "Anchor Program client not wired — replace this harness with provider.Program once build/deploy works."
  );
}

/**
 * Invoke a named instruction through the (future) program client.
 * Always red until requireProgram succeeds and Engineers implement the ix.
 */
export async function invokeIx(caseId: string, ix: IxName, _args?: unknown): Promise<never> {
  void ix;
  return requireProgram(caseId);
}

/**
 * Pure pyth_price_to_e6 — MUST match programs/meridian utils/pyth once implemented.
 * Absent by design so S-10 stays red until Engineers land the Rust fn (or export a TS twin).
 */
export function pythPriceToE6(_price: bigint, _expo: number): bigint {
  throw new TddRedError(
    "S-10",
    "pyth_price_to_e6 not implemented (units.md §4.2 / §8). Export from program utils or mirror in tests/helpers after Engineers land it."
  );
}
