/**
 * Anchor Program wrapper.
 * Prod/devnet path refuses fixture IDL (sim_*, upsert_mock_pyth, test_drain_vault, SimClock ixs).
 */
import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program, Idl, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AutomationConfig, FIXTURE_IX_NAMES, SolanaCluster } from "../config";

export interface LoadedIdl extends Idl {
  address: string;
}

export function loadIdlJson(idlPath: string): LoadedIdl {
  const abs = path.isAbsolute(idlPath) ? idlPath : path.resolve(process.cwd(), idlPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`IDL not found at ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, "utf8")) as LoadedIdl;
}

export function idlInstructionNames(idl: Idl): string[] {
  return (idl.instructions ?? []).map((i) => i.name);
}

export function assertProdIdlSafe(idl: Idl, cluster: SolanaCluster): void {
  if (cluster === "localnet") return;
  const names = new Set(idlInstructionNames(idl));
  const hits = FIXTURE_IX_NAMES.filter((n) => names.has(n));
  if (hits.length > 0) {
    throw new Error(
      `Refusing to load fixture IDL on cluster=${cluster}. Found: ${hits.join(", ")}. ` +
        `Use idl/meridian.prod.json (DEPLOY.md §2 / D-017).`
    );
  }
}

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

export function createProvider(connection: Connection, payer: Keypair): AnchorProvider {
  const wallet = new Wallet(payer);
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function createProgram(
  cfg: AutomationConfig,
  payer: Keypair
): { program: Program; idl: LoadedIdl; connection: Connection; provider: AnchorProvider } {
  const idl = loadIdlJson(cfg.idlPath);
  assertProdIdlSafe(idl, cfg.cluster);

  if (idl.address && idl.address !== cfg.programId.toBase58()) {
    // Soft warn — address in IDL should match env program id.
    console.warn(
      `[automation] IDL address ${idl.address} != MERIDIAN_PROGRAM_ID ${cfg.programId.toBase58()}`
    );
  }

  const connection = createConnection(cfg.rpcUrl);
  const provider = createProvider(connection, payer);
  // Anchor 0.31: Program(idl, provider) — program id from idl.address
  const program = new Program({ ...idl, address: cfg.programId.toBase58() } as Idl, provider);
  return { program, idl, connection, provider };
}

/** True if this IDL exposes localnet sim session ixs (must not be used by worker entry). */
export function idlHasSimFixtures(idl: Idl): boolean {
  const names = new Set(idlInstructionNames(idl));
  return (
    names.has("sim_open_session") ||
    names.has("simOpenSession") ||
    names.has("upsert_mock_pyth") ||
    names.has("upsertMockPyth")
  );
}
