import { afterEach, expect, it, vi } from "vitest";
import {
  extractDocument,
  inspectDocx,
} from "../../../apps/api/src/adapters/document-parser";
import {
  createDocumentConverterAdapter,
  validateDocumentConverterOrigin,
} from "../../../apps/api/src/adapters/document-converter";
import {
  textPdf,
  textDocx,
  documentZip,
} from "../../support/document-fixtures";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Server } from "node:http";
afterEach(() => vi.restoreAllMocks());

it("extracts synthetic PDF and DOCX content without provider requests", async () => {
  // Exercise the actual isolated entrypoint. Transforming PDF.js through the
  // test runner is neither the production worker nor its resource boundary.
  const module = await import(
    /* @vite-ignore */ pathToFileURL(
      resolve("apps/api/dist/document-converter.js"),
    ).href
  );
  const server: Server = module.createDocumentConverter();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Converter did not bind its test port.");
  const transport = globalThis.fetch;
  const calls = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => {
      if (String(input) !== `http://127.0.0.1:${address.port}/extract`)
        throw new Error("EXTERNAL_NETWORK_DISABLED");
      return transport(input, init);
    });
  try {
    for (const [format, bytes, expected] of [
      ["pdf", textPdf(), "Review repository visibility"],
      ["docx", textDocx(), "Choose New repository"],
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${address.port}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, base64: bytes.toString("base64") }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).text).toContain(expected);
    }
    expect(calls).toHaveBeenCalledTimes(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it("keeps authored HTML headings while dropping active, hidden and form content", async () => {
  const html =
    '<html><body><nav>NOISY_NAV</nav><main><h1>Repository help</h1><p>Review visibility.</p><script>PRIVATE_SCRIPT</script><input value="PRIVATE_FIELD"><div hidden>PRIVATE_HIDDEN</div><footer>NOISY_FOOTER</footer></main></body></html>';
  const text = await extractDocument(Buffer.from(html), "html");
  expect(text).toContain("# Repository help");
  expect(text).toContain("Review visibility.");
  expect(text).not.toMatch(/PRIVATE_|NOISY_/);
});
it("rejects traversal, archive expansion and unsupported documents before conversion", async () => {
  expect(() =>
    inspectDocx(documentZip({ "../word/document.xml": "bad" })),
  ).toThrow();
  const bomb = textDocx(),
    index = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(0x7fffffff, index + 24);
  expect(() => inspectDocx(bomb)).toThrow();
  await expect(
    extractDocument(Buffer.from("not a PDF"), "pdf"),
  ).rejects.toThrow();
  await expect(extractDocument(new Uint8Array(), "text")).rejects.toThrow();
});
it("pins converter destinations and does not expose raw converter errors", async () => {
  for (const origin of [
    "https://example.test",
    "http://169.254.169.254",
    "http://document-converter:8796/private",
    "http://127.0.0.1:99999",
  ])
    expect(() => validateDocumentConverterOrigin(origin)).toThrow();
  const transport = vi.fn(
    async () => new Response("PRIVATE_DOCUMENT_SENTINEL", { status: 500 }),
  );
  const adapter = createDocumentConverterAdapter(
    "http://document-converter:8796",
    transport,
  );
  await expect(
    adapter.extract(
      { format: "pdf", base64: "eA==" },
      {
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10000,
      },
    ),
  ).rejects.toThrow("could not be extracted");
  expect(transport.mock.calls).toHaveLength(1);
});
