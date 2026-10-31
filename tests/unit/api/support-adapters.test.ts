import { createHash, randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import {
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSmtpMailer } from "../../../apps/api/src/adapters/smtp";
import { createS3Objects } from "../../../apps/api/src/adapters/s3";
import {
  diagnosticBytes,
  privateExportBytes,
} from "../../../apps/api/src/application/private-files";
import { savedDataRecordFixture } from "../../support/saved-data-fixture";
import type {
  ApprovedMail,
  PrivateFile,
} from "../../../apps/api/src/application/support-contracts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function listen(server: HttpServer | TcpServer, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const message: ApprovedMail = {
  template: "support.operator",
  templateVersion: 1,
  messageId: randomUUID(),
  requestId: randomUUID(),
  email: "reply@example.test",
  topic: "Support",
  subject: "Finding settings",
  message: "A synthetic support message.",
};
async function smtp(mode: "accept" | "drop-data" | "stall") {
  const bodies: string[] = [],
    recipients: string[] = [];
  let connections = 0,
    closed = 0;
  const server = createTcpServer((socket) => {
    connections++;
    socket.on("error", () => {});
    socket.on("close", () => closed++);
    if (mode === "stall") return;
    socket.write("220 local.test ESMTP\r\n");
    let buffer = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        if (data) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          bodies.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          data = false;
          if (mode === "drop-data") {
            socket.destroy();
            return;
          }
          socket.write("250 queued locally\r\n");
          continue;
        }
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write("250 local.test\r\n");
        else if (/^MAIL FROM:/.test(line)) socket.write("250 sender\r\n");
        else if (/^RCPT TO:/.test(line)) {
          recipients.push(line);
          socket.write("250 recipient\r\n");
        } else if (line === "DATA") {
          data = true;
          socket.write("354 continue\r\n");
        } else if (line === "QUIT") {
          socket.end("221 goodbye\r\n");
          return;
        }
      }
    });
  });
  await listen(server, 1025);
  const mail = createSmtpMailer(
    {
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      requireTLS: false,
      from: "noreply@example.test",
      supportRecipient: "operator@example.test",
      localCapture: true,
      timeoutMs: 1000,
    },
    true,
  );
  cleanups.push(() => mail.close());
  return { mail, bodies, recipients, counts: () => ({ connections, closed }) };
}

describe("local SMTP notification adapter", () => {
  it("sends only the approved plain-text template to the configured support recipient", async () => {
    const f = await smtp("accept");
    expect(await f.mail.send(message, new AbortController().signal)).toBe(
      "accepted",
    );
    expect(f.recipients).toEqual(["RCPT TO:<operator@example.test>"]);
    expect(f.bodies).toHaveLength(1);
    expect(f.bodies[0]).toContain("Content-Type: text/plain");
    expect(f.bodies[0]).toContain(
      `Message-ID: <${message.messageId}@tholi.invalid>`,
    );
    expect(f.bodies[0]).toContain("Reply-To: reply@example.test");
    const connections = f.counts().connections;
    await expect(
      f.mail.send(
        { ...message, subject: "Injected\r\nBcc: victim@example.test" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await expect(
      f.mail.send(
        { ...message, to: "victim@example.test" } as ApprovedMail,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(f.counts().connections).toBe(connections);
  });
  it("reports an unknown outcome when the server takes DATA and drops its final reply", async () => {
    const f = await smtp("drop-data");
    expect(await f.mail.send(message, new AbortController().signal)).toBe(
      "uncertain",
    );
    expect(f.bodies).toHaveLength(1);
    expect(f.counts().connections).toBe(1);
  });
  it("actually closes an in-flight SMTP socket on cancellation", async () => {
    const f = await smtp("stall");
    const controller = new AbortController();
    const send = f.mail.send(message, controller.signal);
    while (!f.counts().connections)
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(["not-sent", "uncertain"]).toContain(await send);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.counts().closed).toBe(1);
    expect(f.bodies).toEqual([]);
  });
});

async function objects() {
  const payload = diagnosticBytes({
    schemaVersion: 1,
    version: "0.11.0",
    profile: "service",
    accountStatus: "active",
    workspaceKind: "personal",
    role: "owner",
    jobs: {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      uncertain: 0,
    },
  });
  const id = randomUUID(),
    workspaceId = randomUUID();
  const file: PrivateFile = {
    id,
    requestId: randomUUID(),
    revision: 1n,
    key: `exports/${workspaceId}/${id}.json`,
    bytes: payload.bytes,
    sha256: payload.sha256,
    contentType: "application/json",
    expiresAt: new Date(Date.now() + 3600000),
    status: "pending",
  };
  let stored: Buffer | undefined,
    requests = 0,
    corrupt = false,
    stall = false,
    connectionClosed = false;
  const server = createHttpServer(async (request, response) => {
    requests++;
    request.socket.once("close", () => {
      connectionClosed = true;
    });
    if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === "HEAD") {
      response.writeHead(200).end();
      return;
    }
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      stored = Buffer.concat(chunks);
      response.writeHead(200, { ETag: '"synthetic"' }).end();
      return;
    }
    if (request.method === "DELETE") {
      stored = undefined;
      response.writeHead(204).end();
      return;
    }
    if (stall) return;
    if (!stored) {
      response
        .writeHead(404, { "Content-Type": "application/xml" })
        .end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    const bytes = corrupt
      ? Buffer.from(
          stored.map((value, index) => (index === 0 ? value ^ 1 : value)),
        )
      : stored;
    response
      .writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": bytes.length,
      })
      .end(bytes);
  });
  const endpoint = await listen(server);
  const adapter = createS3Objects(
    {
      endpoint,
      region: "us-east-1",
      bucket: "tholi-local",
      accessKey: "synthetic-access",
      secretKey: "synthetic-secret",
      maxBytes: 131072,
      timeoutMs: 1000,
    },
    true,
  );
  cleanups.push(() => adapter.close());
  return {
    adapter,
    file,
    payload,
    requests: () => requests,
    stored: () => stored,
    corrupt: () => {
      corrupt = true;
    },
    stall: () => {
      stall = true;
    },
    closed: () => connectionClosed,
  };
}

describe("private S3-compatible adapter", () => {
  it("uses signed bounded requests and validates actual bytes before returning or persisting", async () => {
    const f = await objects(),
      signal = new AbortController().signal;
    expect(await f.adapter.ready()).toBe(true);
    await f.adapter.put(f.file, f.payload.body, signal);
    expect(f.stored()).toEqual(f.payload.body);
    expect(await f.adapter.read(f.file, signal)).toEqual(f.payload.body);
    const requests = f.requests();
    await expect(
      f.adapter.put(
        { ...f.file, key: "../foreign.json" },
        f.payload.body,
        signal,
      ),
    ).rejects.toThrow();
    await expect(
      f.adapter.put(f.file, Buffer.from("unapproved"), signal),
    ).rejects.toThrow();
    expect(f.requests()).toBe(requests);
    f.corrupt();
    await expect(f.adapter.read(f.file, signal)).rejects.toThrow(
      "could not be retrieved",
    );
    await f.adapter.delete(f.file, signal);
    await f.adapter.delete(f.file, signal);
    expect(f.stored()).toBeUndefined();
  });
  it("roundtrips each approved export purpose and rejects purpose or credential fields before PUT", async () => {
    const f = await objects(),
      signal = new AbortController().signal,
      now = new Date().toISOString(),
      generation = randomUUID(),
      accountId = randomUUID();
    const snapshots = [
      {
        purpose: "saved-data-export",
        snapshot: {
          schemaVersion: 1,
          kind: "saved-data-export",
          createdAt: now,
          items: [savedDataRecordFixture()],
        },
      },
      {
        purpose: "account-export-part",
        snapshot: {
          schemaVersion: 1,
          kind: "account-export-part",
          generation,
          accountId,
          workspaceId: null,
          cutoff: now,
          section: "profile",
          items: [{ accountId, revision: "1", createdAt: now, updatedAt: now }],
        },
      },
      {
        purpose: "account-export-manifest",
        snapshot: {
          schemaVersion: 1,
          kind: "account-export-manifest",
          generation,
          accountId,
          startedAt: now,
          completedAt: now,
          cutoff: now,
          consistency: "collected-over-interval",
          scope: { workspaces: "current-memberships", workspaceIds: [] },
          parts: [],
          previousManifestFileId: null,
          continuation: null,
          complete: true,
          omissions: [],
        },
      },
    ] as const;
    for (const { purpose, snapshot } of snapshots) {
      const payload = privateExportBytes(snapshot, purpose),
        file: PrivateFile = {
          ...f.file,
          purpose,
          bytes: payload.bytes,
          sha256: payload.sha256,
        };
      await f.adapter.put(file, payload.body, signal);
      expect(f.stored()).toEqual(payload.body);
      expect(await f.adapter.read(file, signal)).toEqual(payload.body);
      const before = f.requests();
      await expect(
        f.adapter.put({ ...file, purpose: "diagnostic" }, payload.body, signal),
      ).rejects.toThrow();
      const credentialBody = Buffer.from(
        JSON.stringify({ ...snapshot, credentials: "PRIVATE_AUTH_SECRET" }),
      );
      await expect(
        f.adapter.put(
          {
            ...file,
            bytes: credentialBody.byteLength,
            sha256: createHash("sha256").update(credentialBody).digest("hex"),
          },
          credentialBody,
          signal,
        ),
      ).rejects.toThrow();
      expect(f.requests()).toBe(before);
    }
  });
  it("aborts an actual object request without hidden SDK retries", async () => {
    const f = await objects();
    f.stall();
    const controller = new AbortController();
    const pending = f.adapter.read(f.file, controller.signal);
    while (!f.requests())
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await expect(pending).rejects.toThrow("could not be retrieved");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.requests()).toBe(1);
    expect(f.closed()).toBe(true);
  });
});
