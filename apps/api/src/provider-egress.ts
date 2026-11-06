import { createServer } from "node:http";
import { connect as connectSocket, BlockList, isIP, Socket } from "node:net";
import { lookup as lookupAddress } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { Duplex } from "node:stream";
import { CUSTOMER_PROVIDER_ENDPOINTS } from "./adapters/provider-network";
import { isMainModule } from "./runtime";

const destinations = new Set(
  Object.values(CUSTOMER_PROVIDER_ENDPOINTS).map(
    (value) => new URL(value).hostname + ":443",
  ),
);
const privateIPv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  privateIPv4.addSubnet(address, prefix, "ipv4");
const publicIPv6 = new BlockList();
publicIPv6.addSubnet("2000::", 3, "ipv6");
const reservedIPv6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], // Special-purpose protocols, including Teredo.
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4 can embed an otherwise prohibited IPv4 destination.
  ["3fff::", 20],
] as const)
  reservedIPv6.addSubnet(address, prefix, "ipv6");

export function publicProviderAddress(address: string) {
  return typeof address === "string" && isIP(address) === 4
    ? !privateIPv4.check(address, "ipv4")
    : typeof address === "string" &&
        isIP(address) === 6 &&
        publicIPv6.check(address, "ipv6") &&
        !reservedIPv6.check(address, "ipv6");
}

interface EgressDependencies {
  lookup?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<readonly LookupAddress[]>;
  connect?: (options: { host: string; family: 4 | 6; port: 443 }) => Socket;
}

/** Optional infrastructure tunnel. Provider TLS and credentials remain end to end. */
export function createProviderEgress(dependencies: EgressDependencies = {}) {
  const lookup: NonNullable<EgressDependencies["lookup"]> =
    dependencies.lookup ??
    ((hostname, options) => lookupAddress(hostname, options));
  const connect = dependencies.connect ?? connectSocket;
  const sockets = new Set<Socket>();
  const tunnels = new Set<Duplex>();
  // Uncancellable OS lookups retain their admission slot until they settle.
  let pendingLookups = 0;
  let closing: Promise<void> | undefined;
  const server = createServer(
    {
      maxHeaderSize: 4096,
      headersTimeout: 5000,
      requestTimeout: 5000,
      connectionsCheckingInterval: 1000,
      keepAliveTimeout: 1000,
    },
    (request, response) => {
      response.writeHead(
        request.method === "GET" && request.url === "/health" ? 200 : 403,
        { "Cache-Control": "no-store", Connection: "close" },
      );
      response.end();
    },
  );
  server.maxConnections = 32;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 4;
  server.setTimeout(5000, (socket) => socket.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    if (closing) socket.destroy();
  });
  server.on("connect", (request, client, head) => {
    const destination = request.url ?? "";
    if (
      closing ||
      !destinations.has(destination) ||
      head.length ||
      tunnels.size >= 16 ||
      pendingLookups >= 16
    ) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    // Do not buffer arbitrary pre-connect payload while resolving the endpoint.
    client.pause();
    if (client instanceof Socket) client.setTimeout(0);
    tunnels.add(client);
    let upstream: Socket | undefined;
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    let bytes = 0;
    const close = () => {
      clearTimeout(timer);
      clearTimeout(lookupTimer);
      client.destroy();
      upstream?.destroy();
    };
    const timer = setTimeout(close, 25000);
    timer.unref();
    client.on("error", close);
    client.once("close", () => {
      tunnels.delete(client);
      close();
    });
    const count = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 5 * 1024 * 1024) close();
    };
    void (async () => {
      pendingLookups++;
      const resolved = Promise.resolve()
        .then(() =>
          lookup(destination.slice(0, -4), { all: true, verbatim: true }),
        )
        .finally(() => pendingLookups--);
      const records = await Promise.race([
        resolved,
        new Promise<never>((_resolve, reject) => {
          lookupTimer = setTimeout(
            () => reject(new Error("Provider lookup expired.")),
            5000,
          );
          lookupTimer.unref();
        }),
      ]);
      clearTimeout(lookupTimer);
      if (client.destroyed || closing) return;
      if (
        !records.length ||
        records.length > 32 ||
        !records.every(
          (record) =>
            publicProviderAddress(record.address) &&
            isIP(record.address) === record.family,
        )
      )
        throw new Error("Provider address denied.");
      // Pin the checked IP. The dial cannot perform another DNS lookup.
      upstream = connect({
        host: records[0].address,
        family: records[0].family as 4 | 6,
        port: 443,
      });
      upstream.setTimeout(5000, close);
      upstream.on("error", close);
      upstream.once("close", close);
      upstream.once("connect", () => {
        if (client.destroyed || closing) return close();
        upstream!.setTimeout(0);
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.on("data", count);
        upstream!.on("data", count);
        client.pipe(upstream!);
        upstream!.pipe(client);
      });
    })().catch(close);
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  return {
    server,
    close() {
      if (!closing) {
        closing = new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        });
      }
      return closing;
    },
  };
}

if (isMainModule(import.meta.url)) {
  const proxy = createProviderEgress();
  proxy.server.listen(8080, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => void proxy.close());
}
