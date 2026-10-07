import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";
import { loadIdlJson, assertProdIdlSafe, idlHasSimFixtures } from "../src/solana/client";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.resolve(__dirname, "../src");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

describe("mode isolation (prod entry vs sim)", () => {
  it("worker.ts does not import modes/sim", () => {
    const src = read("worker.ts");
    expect(src).to.match(/from ["']\.\/modes\/calendar["']/);
    // Comments may mention sim isolation; assert no import/require of the sim module.
    expect(src).to.not.match(/from ["']\.\/modes\/sim["']/);
    expect(src).to.not.match(/require\(["']\.\/modes\/sim["']\)/);
    expect(src).to.not.match(/upsertMockPyth|sim_open_session|simOpenSession/);
  });

  it("calendar.ts does not reference fixture ixs", () => {
    const src = read("modes/calendar.ts");
    expect(src).to.not.match(/upsert_mock_pyth|sim_open_session|sim_close_session|test_drain_vault/);
    expect(src).to.not.match(/from ["']\.\/sim["']/);
    expect(src).to.not.match(/from ["']\.\.\/modes\/sim["']/);
  });

  it("sim-lifecycle.ts is the entry that imports modes/sim", () => {
    const src = read("sim-lifecycle.ts");
    expect(src).to.match(/modes\/sim/);
    expect(src).to.match(/localnet/i);
  });

  it("prod IDL has no fixture instructions", () => {
    const prodPath = path.join(ROOT, "idl/meridian.prod.json");
    expect(fs.existsSync(prodPath), "meridian.prod.json").to.equal(true);
    const idl = loadIdlJson(prodPath);
    expect(idlHasSimFixtures(idl)).to.equal(false);
    expect(() => assertProdIdlSafe(idl, "devnet")).to.not.throw();
    expect(() => assertProdIdlSafe(idl, "mainnet-beta")).to.not.throw();
  });

  it("localnet IDL has sim fixtures and is refused on devnet", () => {
    const localPath = path.join(ROOT, "idl/meridian.json");
    expect(fs.existsSync(localPath), "meridian.json").to.equal(true);
    const idl = loadIdlJson(localPath);
    expect(idlHasSimFixtures(idl)).to.equal(true);
    expect(() => assertProdIdlSafe(idl, "devnet")).to.throw(/Refusing to load fixture IDL/);
    expect(() => assertProdIdlSafe(idl, "localnet")).to.not.throw();
  });

  it("worker source documents Railway start and prod IDL", () => {
    const src = read("worker.ts");
    expect(src).to.match(/dist\/worker\.js|calendar-only/i);
  });
});
