/**
 * Phoenix seat / claim helpers.
 * Gated: claim requires a live market + wallet; see README Phoenix section.
 */
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface SeatSetupResult {
  ok: boolean;
  message: string;
  instructions: TransactionInstruction[];
  gated: boolean;
}

/**
 * Build maker-setup ixs (ATA + claim seat) when SDK + market are available.
 * Returns gated result when SDK load or market fetch fails.
 */
export async function buildClaimSeatInstructions(
  connection: Connection,
  phoenixMarket: PublicKey,
  trader: PublicKey,
): Promise<SeatSetupResult> {
  try {
    const PhoenixSdk = await import("@ellipsis-labs/phoenix-sdk");
    // createWithoutConfig: no remote master_config (breaks on localnet).
    const client = await PhoenixSdk.Client.createWithoutConfig(
      connection,
      [phoenixMarket],
      false,
    );
    const marketState = client.marketStates.get(phoenixMarket.toBase58());
    if (!marketState) {
      return {
        ok: false,
        gated: true,
        message:
          "Phoenix market account not loaded. Confirm the market pubkey exists on this cluster.",
        instructions: [],
      };
    }
    const ixs = await PhoenixSdk.getMakerSetupInstructionsForMarket(
      connection,
      marketState,
      trader,
    );
    return {
      ok: true,
      gated: false,
      message:
        ixs.length === 0
          ? "Seat and ATAs already ready."
          : `Claim seat / create ATAs: ${ixs.length} instruction(s).`,
      instructions: ixs,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      gated: true,
      message: `Seat setup gated: ${msg}. See apps/web README — Phoenix seat claim.`,
      instructions: [],
    };
  }
}
