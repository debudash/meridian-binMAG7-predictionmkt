import { describe, expect, it } from "vitest";
import { MERIDIAN_IDL } from "./idl";

const FORBIDDEN = [
  "upsert_mock_pyth",
  "test_drain_vault",
  "sim_open_session",
  "sim_close_session",
];

describe("meridian.prod.json web IDL", () => {
  it("does not list localnet fixture instructions", () => {
    const names = new Set((MERIDIAN_IDL.instructions ?? []).map((i) => i.name));
    for (const f of FORBIDDEN) {
      expect(names.has(f), `fixture ix ${f} must not be in web IDL`).toBe(false);
    }
  });

  it("includes user-facing mint and redeem", () => {
    const names = new Set((MERIDIAN_IDL.instructions ?? []).map((i) => i.name));
    expect(names.has("mint")).toBe(true);
    expect(names.has("redeem")).toBe(true);
    expect(names.has("settle")).toBe(true);
  });

  it("program address matches default", () => {
    expect(MERIDIAN_IDL.address).toBe(
      "3X3ETGZYNcZ5BMMxcEuDhXxfisAmWzgqvdnhivbK91Hj",
    );
  });
});
