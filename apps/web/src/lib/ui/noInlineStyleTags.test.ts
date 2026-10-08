/**
 * DLV-077 guard: no inline `<style>{`…`}</style>` text children in components.
 * React SSR escapes `>`, `<`, `&`, quotes inside <style> text (e.g. `.a > *` → `.a &gt; *`),
 * so the server CSS is wrong until hydration and the client text differs → React #425/#422
 * in production. Put CSS in app/globals.css instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("no inline <style> text children (DLV-077)", () => {
  it("src/**/*.tsx has no <style>{…} blocks", () => {
    const offenders = tsxFiles(SRC).filter((f) => /<style[^>]*>\s*\{/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
