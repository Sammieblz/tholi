import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { findCapturedMail } from "../../../scripts/lib/mail-capture.mjs";

test("mail capture searches one phase through loopback HTTP despite a larger identity mailbox", async () => {
  const requestId = randomUUID(),
    unrelated = Array.from({ length: 50 }, (_, index) => ({
      ID: "identity-" + index,
      Subject: "Synthetic identity",
      Text: "Other phase",
    })),
    wanted = ["operator", "receipt"].map((name) => ({
      ID: name,
      Subject: "Synthetic support",
      Text: requestId,
    })),
    mailbox = [...unrelated, ...wanted],
    observed: URL[] = [];
  const server = createServer((request, response) => {
    const target = new URL(request.url!, "http://localhost");
    observed.push(target);
    const matching =
      target.pathname === "/api/v1/search" &&
      target.searchParams.get("query") === `"${requestId}"`
        ? wanted
        : mailbox;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        messages_count: mailbox.length,
        messages: matching.slice(
          0,
          Number(target.searchParams.get("limit") ?? 50),
        ),
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Loopback fixture unavailable");
    const result = await findCapturedMail(
      {
        origin: `http://127.0.0.1:${address.port}`,
        needle: requestId,
        expected: 2,
      },
      async (url) => (await fetch(url)).json(),
    );
    expect(result).toEqual(wanted.map(({ ID, Subject }) => ({ ID, Subject })));
    expect(observed).toHaveLength(1);
    expect(observed[0].pathname).toBe("/api/v1/search");
    expect(observed[0].searchParams.get("limit")).toBe("3");
    expect(observed[0].searchParams.get("start")).toBe("0");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("mail capture rejects missing, surplus, duplicate or unsafe message identities and unsafe lookups", async () => {
  const options = {
    origin: "http://127.0.0.1:8025",
    needle: randomUUID(),
    expected: 2 as const,
  };
  for (const messages of [
    null,
    [],
    [{ ID: "only", Subject: "Synthetic" }],
    Array.from({ length: 3 }, (_, i) => ({
      ID: "message-" + i,
      Subject: "Synthetic",
    })),
    [
      { ID: "same", Subject: "Synthetic" },
      { ID: "same", Subject: "Synthetic" },
    ],
    [
      { ID: "../private", Subject: "Synthetic" },
      { ID: "safe", Subject: "Synthetic" },
    ],
  ])
    await expect(
      findCapturedMail(options, async () => ({ messages })),
    ).rejects.toThrow("The scoped local mail capture is invalid.");
  const read = vi.fn();
  for (const change of [
    { origin: "https://mail.example.test" },
    { origin: options.origin + "/other" },
    { needle: 'subject:"all"' },
    { needle: "-excluded" },
  ])
    await expect(
      findCapturedMail({ ...options, ...change }, read),
    ).rejects.toThrow("The scoped local mail capture is invalid.");
  expect(read).not.toHaveBeenCalled();
});
