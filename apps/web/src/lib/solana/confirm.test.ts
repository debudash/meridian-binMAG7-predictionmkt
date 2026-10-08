/**
 * L14 (Reviewers, !63): never show success when confirmation fails — check value.err and treat a
 * timeout / RPC error as "unconfirmed", not success.
 */
import { describe, expect, it } from "vitest";
import { confirmSignature, toastForConfirm } from "./confirm";

const conn = (impl: () => Promise<{ value: { err: unknown } }>) => ({ confirmTransaction: impl }) as never;

describe("confirmSignature", () => {
  it("confirmed when value.err is null", async () => {
    expect(await confirmSignature(conn(async () => ({ value: { err: null } })), "SIG")).toEqual({ status: "confirmed" });
  });
  it("failed when the tx landed with an error", async () => {
    const r = await confirmSignature(conn(async () => ({ value: { err: { InstructionError: [2, { Custom: 15 }] } } })), "SIG");
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toMatch(/InstructionError/);
  });
  it("unconfirmed when confirmation throws (expiry / timeout / RPC)", async () => {
    const r = await confirmSignature(
      conn(async () => {
        throw new Error("Transaction was not confirmed in 30.00 seconds");
      }),
      "SIG",
    );
    expect(r.status).toBe("unconfirmed");
  });
});

describe("toastForConfirm", () => {
  it("success only when confirmed", () => {
    expect(toastForConfirm({ status: "confirmed" }, "Cancelled 2 orders.", "SIGNATURE1234")).toEqual({
      kind: "success",
      message: "Cancelled 2 orders. · SIGNATUR…",
    });
  });
  it("failed on-chain → error, never success", () => {
    const t = toastForConfirm({ status: "failed", error: '{"InstructionError":[2,{"Custom":15}]}' }, "Cancelled 2 orders.", "SIGNATURE1234");
    expect(t.kind).toBe("error");
    expect(t.message).toMatch(/failed on-chain/i);
    expect(t.message).not.toMatch(/^Cancelled/);
  });
  it("unconfirmed → neutral with a check-explorer hint", () => {
    const t = toastForConfirm({ status: "unconfirmed", error: "timeout" }, "Cancelled 2 orders.", "SIGNATURE1234");
    expect(t.kind).toBe("neutral");
    expect(t.message).toMatch(/not confirmed/i);
  });
});
