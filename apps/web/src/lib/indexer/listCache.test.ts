/**
 * M4 / L10 (Reviewers): the market scan (full GPA) is cached server-side for a short TTL and
 * concurrent callers share one in-flight read; failures are cached only briefly.
 */
import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./listCache";

describe("createTtlCache", () => {
  it("serves repeat calls inside the TTL from cache and re-reads after it", async () => {
    let t = 1_000;
    const load = vi.fn(async () => ({ failed: false, n: load.mock.calls.length }));
    const c = createTtlCache(load, { ttlMs: 20_000, failureTtlMs: 3_000, now: () => t });
    await c.get();
    await c.get();
    t += 19_999;
    await c.get();
    expect(load).toHaveBeenCalledTimes(1);
    t += 2;
    await c.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("dedupes concurrent reads into one in-flight call", async () => {
    const load = vi.fn(() => new Promise<{ failed: boolean }>((r) => setTimeout(() => r({ failed: false }), 5)));
    const c = createTtlCache(load, { ttlMs: 20_000, failureTtlMs: 3_000 });
    await Promise.all([c.get(), c.get(), c.get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("caches failed reads only for the short failure TTL", async () => {
    let t = 0;
    const load = vi.fn(async () => ({ failed: true }));
    const c = createTtlCache(load, { ttlMs: 20_000, failureTtlMs: 3_000, now: () => t });
    await c.get();
    t += 2_000;
    await c.get();
    expect(load).toHaveBeenCalledTimes(1);
    t += 1_500;
    await c.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("a thrown load is not cached", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ failed: false });
    const c = createTtlCache(load, { ttlMs: 20_000, failureTtlMs: 3_000 });
    await expect(c.get()).rejects.toThrow("boom");
    await c.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("ttl 0 disables caching", async () => {
    const load = vi.fn(async () => ({ failed: false }));
    const c = createTtlCache(load, { ttlMs: 0, failureTtlMs: 0 });
    await c.get();
    await c.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
