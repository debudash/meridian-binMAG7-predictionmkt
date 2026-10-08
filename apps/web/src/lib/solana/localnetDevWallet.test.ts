import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { isLocalnetDevWalletAllowed } from "./localnetDevWallet";
import { GET } from "@/app/api/localnet-dev-wallet/route";

const LOCAL = { cluster: "localnet", flag: "true", rpcUrl: "http://127.0.0.1:8899" };

describe("isLocalnetDevWalletAllowed (hard gate)", () => {
  it("allows only localnet + flag + loopback RPC", () => {
    expect(isLocalnetDevWalletAllowed(LOCAL)).toBe(true);
    expect(isLocalnetDevWalletAllowed({ ...LOCAL, rpcUrl: "http://localhost:8899/" })).toBe(true);
  });

  it.each([
    ["devnet cluster", { ...LOCAL, cluster: "devnet" }],
    ["mainnet cluster", { ...LOCAL, cluster: "mainnet-beta" }],
    ["unset cluster", { ...LOCAL, cluster: undefined }],
    ["flag unset", { ...LOCAL, flag: undefined }],
    ["flag not 'true'", { ...LOCAL, flag: "1" }],
    ["remote RPC", { ...LOCAL, rpcUrl: "https://api.devnet.solana.com" }],
    ["lookalike host", { ...LOCAL, rpcUrl: "http://127.0.0.1.evil.example:8899" }],
    ["no RPC", { ...LOCAL, rpcUrl: undefined }],
    ["production build (NODE_ENV=production)", { ...LOCAL, nodeEnv: "production" }],
  ])("denies: %s", (_label, env) => {
    expect(isLocalnetDevWalletAllowed(env)).toBe(false);
  });
});

describe("/api/localnet-dev-wallet", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("404s when cluster is not localnet (keypair path set)", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
    process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
    process.env.LOCALNET_DEV_WALLET_KEYPAIR = "/nonexistent.json";
    const res = await GET(new Request("http://localhost:3000/api/localnet-dev-wallet", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(404);
  });

  it("404s for a non-loopback Host even when localnet-gated", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
    process.env.LOCALNET_DEV_WALLET_KEYPAIR = "/nonexistent.json";
    const res = await GET(new Request("http://10.0.0.5:3000/api/localnet-dev-wallet", { headers: { host: "10.0.0.5:3000" } }));
    expect(res.status).toBe(404);
  });

  it("404s for a spoofed loopback Host when Next forwarded a non-loopback client address (DLV-080)", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
    process.env.LOCALNET_DEV_WALLET_KEYPAIR = "/nonexistent.json";
    const res = await GET(
      new Request("http://localhost:3000/api/localnet-dev-wallet", {
        headers: { host: "localhost:3000", "x-forwarded-for": "172.30.0.2" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("404s in a production build even with every localnet env set (DLV-080)", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
    process.env.LOCALNET_DEV_WALLET_KEYPAIR = "/nonexistent.json";
    (process.env as Record<string, string>).NODE_ENV = "production";
    const res = await GET(new Request("http://127.0.0.1:3000/api/localnet-dev-wallet", { headers: { host: "127.0.0.1:3000" } }));
    expect(res.status).toBe(404);
  });

  it("404s when no keypair path is configured", async () => {
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
    process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
    delete process.env.LOCALNET_DEV_WALLET_KEYPAIR;
    const res = await GET(new Request("http://localhost:3000/api/localnet-dev-wallet", { headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(404);
  });

  async function listenLoopback(host = "127.0.0.1") {
    const srv = net.createServer((sock) => sock.end());
    await new Promise<void>((res) => srv.listen(0, host, () => res()));
    return { port: (srv.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => srv.close(() => r())) };
  }

  it("404s when the dev server is reachable off-loopback even with spoofed loopback headers (DLV-081)", async () => {
    const kp = Keypair.generate();
    const file = path.join(os.tmpdir(), `meridian-dev-wallet-test-exposed-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    const srv = await listenLoopback("0.0.0.0"); // stands in for `next dev -H 0.0.0.0`
    try {
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
      process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
      process.env.LOCALNET_DEV_WALLET_KEYPAIR = file;
      process.env.PORT = String(srv.port);
      const res = await GET(
        new Request(`http://127.0.0.1:${srv.port}/api/localnet-dev-wallet`, {
          headers: { host: `127.0.0.1:${srv.port}`, "x-forwarded-for": "127.0.0.1" },
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      await srv.close();
      fs.rmSync(file, { force: true });
    }
  });

  it("serves the keypair only when every gate passes (temp throwaway key)", async () => {
    const srv = await listenLoopback(); // stands in for `next dev -H 127.0.0.1`
    process.env.PORT = String(srv.port);
    const kp = Keypair.generate();
    const file = path.join(os.tmpdir(), `meridian-dev-wallet-test-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    try {
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "localnet";
      process.env.NEXT_PUBLIC_LOCALNET_DEV_WALLET = "true";
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:8899";
      process.env.LOCALNET_DEV_WALLET_KEYPAIR = file;
      const res = await GET(
        new Request("http://127.0.0.1:3000/api/localnet-dev-wallet", {
          headers: { host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { secretKey: number[] };
      expect(Keypair.fromSecretKey(Uint8Array.from(body.secretKey)).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    } finally {
      await srv.close();
      fs.rmSync(file, { force: true });
    }
  });
});
