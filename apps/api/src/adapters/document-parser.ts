import { parentPort } from "node:worker_threads";
import { parseHTML } from "linkedom";
import { ORGANIZATION_LIMITS } from "../../../../packages/navigation-core/contracts-organization";

export type DocumentFormat = "text" | "markdown" | "html" | "pdf" | "docx";
function bounded(text: string) {
  const clean = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!clean || Buffer.byteLength(clean) > ORGANIZATION_LIMITS.extractedBytes)
    throw new Error("DOCUMENT_UNSUPPORTED");
  return clean;
}
/** Inspect ZIP directory limits before handing a DOCX archive to its parser. */
export function inspectDocx(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  if (data.readUInt32LE(0) !== 0x04034b50)
    throw new Error("DOCUMENT_UNSUPPORTED");
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0 || end + 22 + data.readUInt16LE(end + 20) !== data.length)
    throw new Error("DOCUMENT_UNSUPPORTED");
  const entries = data.readUInt16LE(end + 10),
    size = data.readUInt32LE(end + 12),
    offset = data.readUInt32LE(end + 16);
  if (
    data.readUInt16LE(end + 4) ||
    data.readUInt16LE(end + 6) ||
    !entries ||
    entries > 2048 ||
    offset + size > end
  )
    throw new Error("DOCUMENT_UNSUPPORTED");
  let cursor = offset,
    expanded = 0,
    hasDocument = false;
  for (let i = 0; i < entries; i++) {
    if (
      cursor + 46 > offset + size ||
      data.readUInt32LE(cursor) !== 0x02014b50 ||
      data.readUInt16LE(cursor + 8) & 1
    )
      throw new Error("DOCUMENT_UNSUPPORTED");
    const length = data.readUInt16LE(cursor + 28),
      extra = data.readUInt16LE(cursor + 30),
      comment = data.readUInt16LE(cursor + 32);
    const compressed = data.readUInt32LE(cursor + 20),
      uncompressed = data.readUInt32LE(cursor + 24);
    expanded += uncompressed;
    const next = cursor + 46 + length + extra + comment;
    if (
      next > offset + size ||
      expanded > 20 * 1024 * 1024 ||
      uncompressed > Math.max(compressed * 100, 1024 * 1024)
    )
      throw new Error("DOCUMENT_UNSUPPORTED");
    const name = data.toString("utf8", cursor + 46, cursor + 46 + length);
    if (
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      throw new Error("DOCUMENT_UNSUPPORTED");
    hasDocument ||= name === "word/document.xml";
    cursor = next;
  }
  if (!hasDocument || cursor !== offset + size)
    throw new Error("DOCUMENT_UNSUPPORTED");
}
export async function extractDocument(
  bytes: Uint8Array,
  format: DocumentFormat,
): Promise<string> {
  if (!bytes.length || bytes.length > ORGANIZATION_LIMITS.documentBytes)
    throw new Error("DOCUMENT_UNSUPPORTED");
  if (format === "pdf") {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("DOCUMENT_UNSUPPORTED");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      verbosity: 0,
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
      stopAtErrors: true,
    });
    try {
      const document = await loading.promise;
      if (document.numPages > ORGANIZATION_LIMITS.pages)
        throw new Error("DOCUMENT_UNSUPPORTED");
      let text = "";
      for (let n = 1; n <= document.numPages; n++) {
        const page = await document.getPage(n),
          content = await page.getTextContent();
        text +=
          `\n\n# Page ${n}\n` +
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("");
        if (Buffer.byteLength(text) > ORGANIZATION_LIMITS.extractedBytes)
          throw new Error("DOCUMENT_UNSUPPORTED");
        page.cleanup();
      }
      if (!text.replace(/# Page \d+/g, "").trim())
        throw new Error("DOCUMENT_UNSUPPORTED");
      return bounded(text);
    } finally {
      await loading.destroy();
    }
  }
  if (format === "docx") {
    inspectDocx(bytes);
    const { extractRawText } = await import("mammoth");
    // Raw-text extraction does not resolve external image resources. The pinned
    // Mammoth default also keeps externalFileAccess false; no HTML is rendered.
    return bounded(
      (await extractRawText({ buffer: Buffer.from(bytes) })).value,
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (format !== "html") return bounded(text);
  const { document } = parseHTML(text);
  for (const node of document.querySelectorAll(
    "script,style,noscript,template,iframe,object,embed,input,textarea,select,[contenteditable],[hidden],[aria-hidden=true]",
  ))
    node.remove();
  const root = document.querySelector("main,article") || document.body;
  for (const node of root.querySelectorAll("nav,footer")) node.remove();
  for (const heading of root.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    heading.textContent =
      "\n\n" +
      "#".repeat(Number(heading.localName.slice(1))) +
      " " +
      heading.textContent +
      "\n\n";
  for (const block of root.querySelectorAll("p,li,pre,blockquote,section,div"))
    block.appendChild(document.createTextNode("\n\n"));
  return bounded(root.textContent || "");
}

// The converter's disposable worker has no application secrets or browser state.
parentPort?.on(
  "message",
  async ({ bytes, format }: { bytes: Uint8Array; format: DocumentFormat }) => {
    try {
      parentPort!.postMessage({ text: await extractDocument(bytes, format) });
    } catch {
      parentPort!.postMessage({ error: "DOCUMENT_UNSUPPORTED" });
    }
  },
);
