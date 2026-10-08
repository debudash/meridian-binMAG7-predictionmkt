/**
 * Reviewers mr72-73 staging gates (Debu-only devnet staging):
 *  - M3: the admin_settle fallback price is never the stale pyth-read.py account price. It is the Hermes
 *    price at expiry (publish_time within ADMIN_PRICE_MAX_SKEW_SECS of expiry, sane confidence) or an
 *    operator-supplied price bound to the market with its source logged; anything else is REFUSED.
 *  - Handoff repair: every book in the state (incl. pre-!73 Friday books) is handed to the pauser
 *    (idempotent), and pause-status --expect-pauser flags any book whose SM authority isn't the pauser.
 */
import { expect } from "chai";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { Keypair, PublicKey } from "@solana/web3.js";
import { decideAdminFallbackPrice, priceToE6 } from "../src/pyth/adminFallback";
import { authorityReport, planHandoff } from "../src/phoenix/handoff";
import { PhoenixMarketStatus } from "../src/phoenix/seatManager";
import type { BookAtExpiry, BookState } from "../src/phoenix/pauseAtExpiry";

const OPS = path.join(__dirname, "../../../ops");
const read = (f: string) => fs.readFileSync(path.join(OPS, f), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { adminPriceGuard } = require("../../../ops/lib/admin-price.cjs") as {
  adminPriceGuard: (o: { priceE6?: string; source?: string }) => { ok: boolean; reason?: string; line?: string };
};

const FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const EXP = 1_760_040_000;
const MARKET = "8jvYJm4n3o3Xc6bDdGtS7gS6GmN4V8WgYwF8gk3vM4u7";
const hermes = (over: Partial<{ price: bigint; conf: bigint; expo: number; publishTime: number; feedIdHex: string }> = {}) => ({
  parsed: { feedIdHex: FEED, price: 25_431_000n, conf: 12_000n, expo: -5, publishTime: EXP + 2, prevPublishTime: EXP - 1, ...over },
});
const base = { market: MARKET, expiryTs: EXP, feedIdHex: FEED, maxSkewSecs: 600, maxConfBps: 200 };

describe("M3 admin_settle fallback price (never stale)", () => {
  it("priceToE6 handles negative / positive exponents", () => {
    expect(priceToE6(25_431_000n, -5)).to.equal(254_310_000n);
    expect(priceToE6(30_592_000_000n, -8)).to.equal(305_920_000n);
    expect(priceToE6(30_592_000_050n, -8)).to.equal(305_920_001n); // half-up rounding
    expect(priceToE6(3n, 2)).to.equal(300_000_000n);
  });
  it("Hermes price at expiry within the skew → ok, source names hermes + publish_time", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: hermes() });
    expect(d.ok).to.equal(true);
    if (!d.ok) return;
    expect(d.priceE6).to.equal(254_310_000n);
    expect(d.source).to.match(/^hermes publish_time=1760040002 \(expiry\+2s\)/);
  });
  it("Hermes price long after expiry (market closed / off-hours) → REFUSED without an operator price", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: hermes({ publishTime: EXP + 3600 * 15 }) });
    expect(d.ok).to.equal(false);
    if (d.ok) return;
    expect(d.reason).to.match(/publish_time .* is 54000s from expiry .*\(> 600s/);
    expect(d.reason).to.match(/OPERATOR_PRICE_E6/);
  });
  it("a ~55-day-old price (the pyth-read.py account) is REFUSED", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: hermes({ publishTime: EXP - 55 * 86400 }) });
    expect(d.ok).to.equal(false);
  });
  it("wrong feed / wide confidence / non-positive price → REFUSED", () => {
    expect(decideAdminFallbackPrice({ ...base, hermes: hermes({ feedIdHex: "00".repeat(32) }) }).ok).to.equal(false);
    expect(decideAdminFallbackPrice({ ...base, hermes: hermes({ conf: 1_000_000n }) }).ok).to.equal(false);
    expect(decideAdminFallbackPrice({ ...base, hermes: hermes({ price: 0n }) }).ok).to.equal(false);
  });
  it("Hermes error and no operator price → REFUSED, and the reason carries the Hermes error", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: { error: "Hermes HTTP 404" } });
    expect(d.ok).to.equal(false);
    if (!d.ok) expect(d.reason).to.match(/Hermes HTTP 404/);
  });
  it("operator price needs a source and must be bound to this market", () => {
    const noSrc = decideAdminFallbackPrice({ ...base, hermes: { error: "x" }, operator: { priceE6: "254310000", market: MARKET } });
    expect(noSrc.ok).to.equal(false);
    if (!noSrc.ok) expect(noSrc.reason).to.match(/OPERATOR_PRICE_SOURCE/);
    const other = decideAdminFallbackPrice({ ...base, hermes: { error: "x" }, operator: { priceE6: "254310000", source: "Nasdaq close", market: "11111111111111111111111111111111" } });
    expect(other.ok).to.equal(false);
    if (!other.ok) expect(other.reason).to.match(/OPERATOR_PRICE_MARKET/);
    const bad = decideAdminFallbackPrice({ ...base, hermes: { error: "x" }, operator: { priceE6: "254.31", source: "Nasdaq close", market: MARKET } });
    expect(bad.ok).to.equal(false);
  });
  it("operator price with source + matching market → ok, source logged as operator", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: { error: "Hermes HTTP 404" }, operator: { priceE6: "254310000", source: "Nasdaq official close 2026-10-09", market: MARKET } });
    expect(d.ok).to.equal(true);
    if (d.ok) {
      expect(d.priceE6).to.equal(254_310_000n);
      expect(d.source).to.equal("operator: Nasdaq official close 2026-10-09");
    }
  });
  it("a valid Hermes price wins over a leftover operator price (no static price reuse)", () => {
    const d = decideAdminFallbackPrice({ ...base, hermes: hermes(), operator: { priceE6: "999000000", source: "old", market: MARKET } });
    expect(d.ok && d.priceE6).to.equal(254_310_000n);
  });
});

describe("M3 settle-test.cjs admin price guard", () => {
  it("ADMIN_PRICE_E6 without ADMIN_PRICE_SOURCE is refused", () => {
    const g = adminPriceGuard({ priceE6: "254310000" });
    expect(g.ok).to.equal(false);
    expect(g.reason).to.match(/ADMIN_PRICE_SOURCE/);
  });
  it("non-integer / non-positive prices are refused", () => {
    expect(adminPriceGuard({ priceE6: "254.31", source: "x" }).ok).to.equal(false);
    expect(adminPriceGuard({ priceE6: "0", source: "x" }).ok).to.equal(false);
  });
  it("price + source → ok with a log line naming the source", () => {
    const g = adminPriceGuard({ priceE6: "254310000", source: "hermes publish_time=1 (expiry+1s)" });
    expect(g.ok).to.equal(true);
    expect(g.line).to.equal("admin_settle price source: hermes publish_time=1 (expiry+1s)");
  });
  it("settle-test.cjs uses the guard before admin_settle", () => {
    const src = read("settle-test.cjs");
    expect(src).to.match(/adminPriceGuard\(/);
    expect(src).to.match(/ADMIN_PRICE_SOURCE/);
  });
});

describe("M3 run-staging.sh never settles from pyth-read.py", () => {
  const sh = read("run-staging.sh");
  const code = sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("pyth-read.py is not invoked by the pipeline", () => {
    expect(code).to.not.match(/pyth-read\.py/);
  });
  it("the fallback price comes from ops-cli admin-price and is passed with its source", () => {
    expect(code).to.match(/admin-price --market/);
    expect(code).to.match(/ADMIN_PRICE_SOURCE=/);
    expect(code).to.match(/\[settle\] ALERT/);
  });
  it("pyth-read.py refuses stale prices (age guard)", () => {
    const py = path.join(OPS, "pyth-read.py");
    const r = spawnSync("python3", ["-c", `import importlib.util as u;s=u.spec_from_file_location("p","${py}");m=u.module_from_spec(s);s.loader.exec_module(m);print(m.age_ok(1000,1000+899,900),m.age_ok(1000,1000+901,900),m.age_ok(1000,1000+55*86400,900))`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    expect(r.stderr).to.equal("");
    expect(r.stdout.trim()).to.equal("True False False");
  });
});

const pk = () => Keypair.generate().publicKey;
const book = (label: string): BookAtExpiry => ({ strikeMarket: pk(), phoenixMarket: pk(), expiryTs: EXP, label });
const st = (auth: PublicKey | null, status = PhoenixMarketStatus.Active): BookState => ({ status, seatManagerAuthority: auth });

describe("handoff repair: every book → pauser (incl. pre-!73 Friday books)", () => {
  const pauser = pk();
  const payer = pk();
  it("plans handoff / ok / skip per book, idempotently", () => {
    const [a, b, c, d] = [book("AAPL"), book("NVDA"), book("TSLA"), book("MSFT")];
    const states = new Map<string, BookState>([
      [a.phoenixMarket.toBase58(), st(payer)],
      [b.phoenixMarket.toBase58(), st(pauser)],
      [c.phoenixMarket.toBase58(), st(null)],
      [d.phoenixMarket.toBase58(), st(pk())],
    ]);
    const plan = planHandoff([a, b, c, d], states, payer, pauser);
    expect(plan.map((p) => p.action)).to.deep.equal(["handoff", "ok", "skip-no-psm", "skip-foreign"]);
  });
  it("refuses a pauser equal to the current authority (would silently keep the old authority)", () => {
    expect(() => planHandoff([book("A")], new Map(), payer, payer)).to.throw(/pauser must differ/);
  });
  it("authorityReport lists every book not on the pauser", () => {
    const [a, b, c] = [book("AAPL"), book("NVDA"), book("TSLA")];
    const states = new Map<string, BookState>([
      [a.phoenixMarket.toBase58(), st(pauser)],
      [b.phoenixMarket.toBase58(), st(payer)],
    ]);
    const r = authorityReport([a, b, c], states, pauser);
    expect(r.ok).to.equal(false);
    expect(r.onPauser).to.equal(1);
    expect(r.mismatches.map((m) => m.book.label)).to.deep.equal(["NVDA", "TSLA"]);
    expect(authorityReport([a], states, pauser).ok).to.equal(true);
  });
  it("run-staging.sh runs the handoff repair over the whole state + the expect-pauser gate after each bootstrap phase", () => {
    const sh = read("run-staging.sh");
    const code = sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect((code.match(/handoff_repair\b/g) ?? []).length).to.be.greaterThan(2); // defined + phase 1 + phase 2
    expect(code).to.match(/handoff --state "\$STATE"/);
    expect(code).to.match(/SEAT_MANAGER_AUTHORITY_KEYPAIR=\$UPGRADE_KEY/);
    expect(code).to.match(/ops_cli_ro pause-status --state "\$STATE" --expect-pauser "\$PAUSER_PUB"/);
  });
});
