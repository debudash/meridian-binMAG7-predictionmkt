/**
 * Load production IDL only.
 * NEVER import localnet IDL (`idl/meridian.json` with fixtures) into the web bundle.
 * Fixture-ix absence is enforced by `src/lib/solana/idl.prod.test.ts` + CI assert script.
 */
import type { Idl } from "@coral-xyz/anchor";
import meridianProd from "@/idl/meridian.prod.json";

export const MERIDIAN_IDL = meridianProd as Idl;
