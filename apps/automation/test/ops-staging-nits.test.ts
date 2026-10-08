/**
 * Reviewer nits on the ops/ staging scripts (paused-book MR):
 *  - settle-test.cjs: a missing settler key must not silently skip the Pyth pull settle — warn, and
 *    the "pull settle skipped" line names settler.json (settler key).
 *  - pause-status is read-only: never hand it the pauser key (run-staging.sh ops_cli call, ops/README.md).
 */
import { expect } from "chai";
import fs from "fs";
import path from "path";

const OPS = path.join(__dirname, "../../../ops");
const read = (f: string) => fs.readFileSync(path.join(OPS, f), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pullSettlePlan } = require("../../../ops/lib/pull-settle.cjs") as {
  pullSettlePlan: (o: { hermesKeySet: boolean; automationDist?: string; opsCliExists: boolean; settlerKeyPath: string; settlerKeyExists: boolean }) => {
    run: boolean;
    reasons: string[];
    skipLine: string | null;
    warnings: string[];
  };
};

const ok = { hermesKeySet: true, automationDist: "/a/dist", opsCliExists: true, settlerKeyPath: "/k/settler.json", settlerKeyExists: true };

describe("ops pull-settle plan (settle-test.cjs)", () => {
  it("everything present → runs, no skip line, no warning", () => {
    expect(pullSettlePlan(ok)).to.deep.equal({ run: true, reasons: [], skipLine: null, warnings: [] });
  });
  it("missing settler key → skipped, warned, and the skip line says settler.json (settler key) is missing", () => {
    const p = pullSettlePlan({ ...ok, settlerKeyExists: false });
    expect(p.run).to.equal(false);
    expect(p.skipLine).to.equal(
      "pull settle skipped: settler.json (settler key) missing at /k/settler.json — legacy settle / admin_settle fallback",
    );
    expect(p.warnings).to.have.length(1);
    expect(p.warnings[0]).to.match(/^WARNING settler\.json \(settler key\) missing at \/k\/settler\.json/);
  });
  it("every missing input is named (Hermes key by name only, dist, ops-cli build)", () => {
    const p = pullSettlePlan({ hermesKeySet: false, automationDist: undefined, opsCliExists: false, settlerKeyPath: "/k/s.json", settlerKeyExists: false });
    expect(p.reasons).to.deep.equal([
      "PYTH_HERMES_API_KEY unset",
      "AUTOMATION_DIST unset",
      "settler.json (settler key) missing at /k/s.json",
    ]);
    const q = pullSettlePlan({ ...ok, opsCliExists: false });
    expect(q.reasons).to.deep.equal(["ops-cli.js not built in /a/dist"]);
  });
  it("settle-test.cjs uses the plan (no inline condition that drops the settler reason)", () => {
    const src = read("settle-test.cjs");
    expect(src).to.match(/pullSettlePlan\(/);
    expect(src).to.not.match(/pull settle skipped: \$\{process\.env\.PYTH_HERMES_API_KEY/);
  });
});

describe("pause-status is read-only: no pauser key", () => {
  it("run-staging.sh calls pause-status without PHOENIX_PAUSER_KEYPAIR / SETTLER_KEYPAIR", () => {
    const sh = read("run-staging.sh");
    const calls = sh.split("\n").filter((l) => /pause-status/.test(l) && !/^\s*#/.test(l));
    expect(calls.length).to.be.greaterThan(0);
    for (const l of calls) expect(l).to.match(/ops_cli_ro pause-status/);
    const ro = sh.match(/ops_cli_ro\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ro, "ops_cli_ro defined").to.not.equal("");
    expect(ro).to.not.match(/KEYPAIR=|\$PAUSER_KEY|\$SETTLER_KEY/);
    expect(ro).to.match(/env -u PHOENIX_PAUSER_KEYPAIR -u SETTLER_KEYPAIR/);
  });
  it("ops/README.md documents pause-status without the pauser key", () => {
    const lines = read("README.md").split("\n").filter((l) => /pause-status/.test(l) && /ops-cli\.js/.test(l));
    expect(lines.length).to.be.greaterThan(0);
    for (const l of lines) expect(l).to.not.match(/PHOENIX_PAUSER_KEYPAIR|pauser\.json/);
  });
});
