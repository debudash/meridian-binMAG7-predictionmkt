/**
 * DLV-081 — the dev-wallet route can't trust Host / x-forwarded-for (client-controlled), so it
 * checks the one thing a remote peer can't fake: whether this dev server is reachable on a
 * non-loopback interface. If it is (e.g. `next dev -H 0.0.0.0`), the key is refused.
 */
import net from "node:net";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { findOffLoopbackExposure, nonLoopbackAddresses, __resetExposureCacheForTests } from "./devServerExposure";

afterEach(() => __resetExposureCacheForTests());

const IFACES = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [
    { address: "10.0.0.5", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
} as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;

describe("nonLoopbackAddresses", () => {
  it("lists external IPv4 addresses only (link-local IPv6 skipped)", () => {
    expect(nonLoopbackAddresses(IFACES)).toEqual(["10.0.0.5", "172.17.0.1"]);
  });
});

describe("findOffLoopbackExposure (injected probe)", () => {
  it("returns the first external address that accepts a connection on the dev port", async () => {
    const r = await findOffLoopbackExposure(3000, {
      interfaces: () => IFACES,
      probe: async (host) => host === "172.17.0.1",
    });
    expect(r).toBe("172.17.0.1:3000");
  });

  it("null when no external address accepts (bound to 127.0.0.1)", async () => {
    const r = await findOffLoopbackExposure(3000, { interfaces: () => IFACES, probe: async () => false });
    expect(r).toBeNull();
  });

  it("unknown port → treated as exposed (fail closed)", async () => {
    const r = await findOffLoopbackExposure(undefined, { interfaces: () => IFACES, probe: async () => false });
    expect(r).toMatch(/unknown/);
  });
});

const external = nonLoopbackAddresses(os.networkInterfaces());
describe.skipIf(external.length === 0)("findOffLoopbackExposure (real sockets)", () => {
  async function listen(host: string): Promise<{ port: number; close: () => Promise<void> }> {
    const srv = net.createServer((s) => s.end());
    await new Promise<void>((res) => srv.listen(0, host, () => res()));
    const port = (srv.address() as net.AddressInfo).port;
    return { port, close: () => new Promise<void>((res) => srv.close(() => res())) };
  }

  it("server bound to 127.0.0.1 → not exposed", async () => {
    const s = await listen("127.0.0.1");
    try {
      expect(await findOffLoopbackExposure(s.port)).toBeNull();
    } finally {
      await s.close();
    }
  });

  it("server bound to 0.0.0.0 → exposed on an external address", async () => {
    const s = await listen("0.0.0.0");
    try {
      expect(await findOffLoopbackExposure(s.port)).toMatch(new RegExp(`:${s.port}$`));
    } finally {
      await s.close();
    }
  });
});
