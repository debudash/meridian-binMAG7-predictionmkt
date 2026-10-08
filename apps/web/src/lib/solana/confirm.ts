/**
 * L14 (Reviewers, !63): confirmation outcome that never reports success for a tx that failed
 * on-chain (value.err) or couldn't be confirmed (timeout / blockhash expiry / RPC error).
 */
import type { BlockhashWithExpiryBlockHeight, Commitment, Connection } from "@solana/web3.js";

export type ConfirmOutcome =
  | { status: "confirmed" }
  | { status: "failed"; error: string }
  | { status: "unconfirmed"; error: string };

export async function confirmSignature(
  connection: Pick<Connection, "confirmTransaction">,
  signature: string,
  blockhash?: BlockhashWithExpiryBlockHeight,
  commitment: Commitment = "confirmed",
): Promise<ConfirmOutcome> {
  try {
    const res = blockhash
      ? await connection.confirmTransaction({ signature, ...blockhash }, commitment)
      : await connection.confirmTransaction(signature, commitment);
    if (res.value.err) {
      return { status: "failed", error: typeof res.value.err === "string" ? res.value.err : JSON.stringify(res.value.err) };
    }
    return { status: "confirmed" };
  } catch (e) {
    return { status: "unconfirmed", error: e instanceof Error ? e.message : String(e) };
  }
}

export function toastForConfirm(
  outcome: ConfirmOutcome,
  okMessage: string,
  signature: string,
): { kind: "success" | "error" | "neutral"; message: string } {
  const short = `${signature.slice(0, 8)}…`;
  switch (outcome.status) {
    case "confirmed":
      return { kind: "success", message: `${okMessage} · ${short}` };
    case "failed":
      return { kind: "error", message: `Transaction failed on-chain (${outcome.error.slice(0, 160)}) · ${short}` };
    case "unconfirmed":
      return {
        kind: "neutral",
        message: `Sent but not confirmed yet — check the explorer before retrying · ${short}`,
      };
  }
}
