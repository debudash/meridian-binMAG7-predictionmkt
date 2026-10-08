/**
 * SERVER-ONLY (node:net / node:os). DLV-081.
 *
 * Host and x-forwarded-for are client-controlled, so the localnet dev-wallet route can't use
 * them to prove a request is local. What a remote peer can't fake is how this server is bound:
 * we try to connect to our own dev port on every external interface address. If any accepts,
 * the server is reachable off-loopback (`next dev -H 0.0.0.0` / unbound) and the key is refused.
 * Result is cached briefly so the probe isn't paid on every request.
 */
import net from "node:net";
import os from "node:os";

type Ifaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;
export interface ExposureDeps {
  interfaces: () => Ifaces;
  probe: (host: string, port: number) => Promise<boolean>;
}

const PROBE_TIMEOUT_MS = 300;
const CACHE_MS = 15_000;
let cache: { port: number | undefined; at: number; value: string | null } | null = null;

export function nonLoopbackAddresses(ifaces: Ifaces): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      // Node ≥18 reports family as "IPv4" (older: 4).
      const v4 = a.family === "IPv4" || (a.family as unknown) === 4;
      if (!a.internal && v4) out.push(a.address);
    }
  }
  return out;
}

export function tcpProbe(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

const defaultDeps: ExposureDeps = { interfaces: () => os.networkInterfaces(), probe: (h, p) => tcpProbe(h, p) };

/**
 * `host:port` of the first external address that accepts a TCP connection on `port`,
 * `"unknown-port"` when the port can't be determined (fail closed), or null when the
 * server is loopback-only.
 */
export async function findOffLoopbackExposure(
  port: number | undefined,
  deps: ExposureDeps = defaultDeps,
): Promise<string | null> {
  if (!port || !Number.isInteger(port) || port <= 0) return "unknown-port";
  const addrs = nonLoopbackAddresses(deps.interfaces());
  const results = await Promise.all(addrs.map(async (a) => ((await deps.probe(a, port)) ? a : null)));
  const hit = results.find((r) => r != null);
  return hit ? `${hit}:${port}` : null;
}

/** Cached exposure check for the running dev server (`process.env.PORT`, set by `next dev`). */
export async function devServerExposure(nowMs = Date.now()): Promise<string | null> {
  const port = process.env.PORT ? Number(process.env.PORT) : undefined;
  if (cache && cache.port === port && nowMs - cache.at < CACHE_MS) return cache.value;
  const value = await findOffLoopbackExposure(port);
  cache = { port, at: nowMs, value };
  return value;
}

export function __resetExposureCacheForTests(): void {
  cache = null;
}
