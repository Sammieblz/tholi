import { afterEach, expect, test, vi } from "vitest";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { LookupAddress } from "node:dns";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseDocument } from "yaml";
import {
  createProviderEgress,
  publicProviderAddress,
} from "../../../apps/api/src/provider-egress";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanups.splice(0).reverse()) await close();
});
const publicAddress = { address: "8.8.8.8", family: 4 };
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return (server.address() as { port: number }).port;
}
async function until(condition: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await delay(10);
  }
  throw new Error("Loopback egress fixture did not settle.");
}
async function echo() {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    socket.pipe(socket);
  });
  cleanups.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return listen(server);
}
async function proxy(
  overrides: Parameters<typeof createProviderEgress>[0] = {},
) {
  // Every test replaces both network owners. No provider DNS or dial is possible.
  const lookup = vi.fn(async () => [publicAddress]);
  const dial = vi.fn((): Socket => {
    throw new Error("An unplanned provider dial was prevented.");
  });
  const app = createProviderEgress({ lookup, connect: dial, ...overrides });
  cleanups.push(() => app.close());
  return { ...app, lookup, dial, port: await listen(app.server) };
}
async function request(port: number, bytes: string | Buffer) {
  const socket = connect({ host: "127.0.0.1", port });
  let received = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
  });
  socket.on("error", () => socket.destroy());
  cleanups.push(async () => {
    socket.destroy();
  });
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(bytes);
  return { socket, received: () => received };
}
const tunnel = (destination = "api.openai.com:443") =>
  `CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`;

test("only the three exact provider authorities on port 443 tunnel opaque bytes to a checked pinned IP", async () => {
  const port = await echo();
  const lookup = vi.fn(async () => [publicAddress]);
  const dial = vi.fn(() => connect({ host: "127.0.0.1", port }));
  const app = await proxy({ lookup, connect: dial });
  for (const hostname of [
    "api.openai.com",
    "api.anthropic.com",
    "openrouter.ai",
  ]) {
    const address =
      hostname === "api.anthropic.com"
        ? { address: "2606:4700:4700::1111", family: 6 }
        : publicAddress;
    lookup.mockResolvedValue([address]);
    const client = await request(app.port, tunnel(`${hostname}:443`));
    await until(() => client.received().includes("\r\n\r\n"));
    expect(client.received().toString()).toBe(
      "HTTP/1.1 200 Connection Established\r\n\r\n",
    );
    // Synthetic binary payload. The tunnel does not interpret TLS or inject headers.
    const payload = Buffer.from([22, 3, 3, 0, 4, 0, 255, 42, 17]);
    const offset = client.received().length;
    client.socket.write(payload);
    await until(() => client.received().length === offset + payload.length);
    expect(client.received().subarray(offset)).toEqual(payload);
    client.socket.destroy();
    expect(lookup).toHaveBeenLastCalledWith(hostname, {
      all: true,
      verbatim: true,
    });
    expect(dial).toHaveBeenLastCalledWith({
      host: address.address,
      family: address.family,
      port: 443,
    });
  }
  expect(lookup).toHaveBeenCalledTimes(3);
  expect(dial).toHaveBeenCalledTimes(3);
});

test("arbitrary hosts, IPs, altered authorities, forward HTTP and early payloads never trigger DNS or dialing", async () => {
  const app = await proxy();
  for (const bytes of [
    ...[
      "elsewhere.example:443",
      "127.0.0.1:443",
      "[::1]:443",
      "api.openai.com:80",
      "API.OPENAI.COM:443",
      "api.openai.com.:443",
      "api.openai.com.evil.example:443",
      "user@api.openai.com:443",
      "https://api.openai.com:443/",
      "api.openai.com:443/path",
    ].map((destination) => tunnel(destination)),
    "GET https://api.openai.com/ HTTP/1.1\r\nHost: api.openai.com\r\n\r\n",
    "POST /health HTTP/1.1\r\nHost: fixture\r\nContent-Length: 0\r\n\r\n",
    tunnel() + "EARLY_SYNTHETIC_BYTES",
    `CONNECT api.openai.com:443 HTTP/1.1\r\nHost: fixture\r\nX-Large: ${"x".repeat(4096)}\r\n\r\n`,
  ]) {
    const client = await request(app.port, bytes);
    await until(() => client.socket.destroyed);
    expect(client.received().toString()).not.toContain(
      "200 Connection Established",
    );
  }
  const health = await request(
    app.port,
    "GET /health HTTP/1.1\r\nHost: fixture\r\n\r\n",
  );
  await until(() => health.socket.destroyed);
  expect(health.received().toString()).toContain("200 OK");
  expect(health.received().toString()).toContain("Cache-Control: no-store");
  expect(app.lookup).not.toHaveBeenCalled();
  expect(app.dial).not.toHaveBeenCalled();
});

test("private, reserved, mixed, invalid-family and oversized DNS answers fail closed before dialing", async () => {
  const denied = [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "3fff::1",
    "not-an-ip",
  ];
  for (const address of denied)
    expect(publicProviderAddress(address)).toBe(false);
  expect(publicProviderAddress(publicAddress.address)).toBe(true);
  expect(publicProviderAddress("2606:4700:4700::1111")).toBe(true);
  const answers: LookupAddress[][] = [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [publicAddress, { address: "169.254.169.254", family: 4 }],
    [{ address: "2606:4700:4700::1111", family: 4 }],
    Array.from({ length: 33 }, () => publicAddress),
  ];
  const lookup = vi.fn(async () => answers.shift()!);
  const app = await proxy({ lookup });
  for (let index = 0; index < 5; index++) {
    const client = await request(app.port, tunnel());
    await until(() => client.socket.destroyed);
    expect(client.received()).toHaveLength(0);
  }
  expect(lookup).toHaveBeenCalledTimes(5);
  expect(app.dial).not.toHaveBeenCalled();
});

test("DNS deadlines release timers but retain bounded admission for uncancellable lookups", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let resolveLookup!: (records: LookupAddress[]) => void;
  const unresolved = new Promise<LookupAddress[]>((resolve) => {
    resolveLookup = resolve;
  });
  const lookup = vi.fn(() => unresolved);
  const app = await proxy({ lookup });
  const clients: Awaited<ReturnType<typeof request>>[] = [];
  for (let index = 0; index < 16; index++)
    clients.push(await request(app.port, tunnel()));
  await until(() => lookup.mock.calls.length === 16);
  await vi.advanceTimersByTimeAsync(5001);
  await until(() => clients.every((client) => client.socket.destroyed));
  const rejected = await request(app.port, tunnel());
  await until(() => rejected.socket.destroyed);
  expect(rejected.received().toString()).toContain("403 Forbidden");
  expect(lookup).toHaveBeenCalledTimes(16);
  expect(app.dial).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  resolveLookup([publicAddress]);
  await Promise.resolve();
  await app.close();
  expect(app.dial).not.toHaveBeenCalled();
});

test("successful lookup timers clear and the fixed tunnel lifetime destroys both ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const port = await echo();
  let upstream: Socket | undefined;
  const app = await proxy({
    connect: () => (upstream = connect({ host: "127.0.0.1", port })),
  });
  const client = await request(app.port, tunnel());
  await until(() => client.received().includes("200 Connection Established"));
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(25000);
  await until(() => client.socket.destroyed && !!upstream?.destroyed);
  expect(vi.getTimerCount()).toBe(0);
});

test("combined tunnel bytes and shutdown bound resources without leaving ordinary HTTP sockets open", async () => {
  const port = await echo();
  const app = await proxy({
    connect: () => connect({ host: "127.0.0.1", port }),
  });
  const client = await request(app.port, tunnel());
  await until(() => client.received().includes("200 Connection Established"));
  client.socket.write(Buffer.alloc(3 * 1024 * 1024));
  await until(() => client.socket.destroyed);
  const partial = await request(app.port, "GET /health HTTP/1.1\r\n");
  const firstClose = app.close();
  expect(app.close()).toBe(firstClose);
  await firstClose;
  await until(() => partial.socket.destroyed);
});

test("the authored BYOK overlay isolates outbound networking and keys while preserving cloud-free base defaults", async () => {
  // This verifies checked-in YAML only. Compose interpolation and runtime remain separate checks.
  const sources = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("infra/local/compose.byok.yaml", "utf8"),
  ]);
  const [base, overlay] = sources.map((source) => {
    const document = parseDocument(source, { merge: true });
    expect(document.errors).toHaveLength(0);
    return document.toJS();
  });
  expect(base.services.api.environment.THOLI_MODEL_PROVIDER).toBe("fake");
  expect(base.services.api.environment).not.toHaveProperty(
    "THOLI_BYOK_ENABLED",
  );
  expect(base.services.api.environment).not.toHaveProperty("HTTPS_PROXY");
  expect(base.services).not.toHaveProperty("provider-egress");
  expect(base.services.api.networks.toSorted()).toEqual([
    "application",
    "database",
  ]);
  expect(overlay.services.api.networks.toSorted()).toEqual([
    "application",
    "database",
    "provider-client",
  ]);
  for (const name of overlay.services.api.networks)
    expect((overlay.networks[name] ?? base.networks[name]).internal).toBe(true);
  const tunnel = overlay.services["provider-egress"];
  expect(tunnel.profiles).toEqual(["byok"]);
  expect(tunnel.networks.toSorted()).toEqual([
    "provider-client",
    "provider-egress",
  ]);
  expect(overlay.networks["provider-egress"]?.internal).not.toBe(true);
  for (const field of [
    "ports",
    "volumes",
    "secrets",
    "privileged",
    "network_mode",
  ])
    expect(tunnel).not.toHaveProperty(field);
  expect(Object.keys(tunnel.environment)).toEqual(["NODE_OPTIONS"]);
  expect(tunnel.read_only).toBe(true);
  expect(tunnel.cap_drop).toEqual(["ALL"]);
  expect(tunnel.logging.driver).toBe("none");
  expect(overlay.services.api.environment).toMatchObject({
    THOLI_BYOK_ENABLED: "true",
    THOLI_NAVIGATION_TRANSPORT_ENABLED: "true",
    NODE_USE_ENV_PROXY: "1",
    HTTPS_PROXY: "http://provider-egress:8080",
  });
  expect(overlay.services.api.volumes).toEqual([
    expect.stringMatching(
      /^\$\{THOLI_BYOK_KEYRING_HOST_FILE:\?[^}]+\}:\/run\/secrets\/tholi-provider-keyring\.json:ro$/,
    ),
  ]);
  expect(overlay.services).not.toHaveProperty("worker");
});
