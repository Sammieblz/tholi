import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import { isMainModule } from "./runtime";
import { ORGANIZATION_LIMITS } from "../../../packages/navigation-core/contracts-organization";

const inputSchema = z
  .object({
    format: z.enum(["text", "markdown", "html", "pdf", "docx"]),
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(ORGANIZATION_LIMITS.documentBytes / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export function createDocumentConverter() {
  let active = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/health/ready") {
      response.end('{"ready":true}');
      return;
    }
    if (request.method !== "POST" || request.url !== "/extract") {
      response.writeHead(404).end("{}");
      return;
    }
    if (active) {
      response.writeHead(429).end('{"error":"BUSY"}');
      return;
    }
    active = true;
    let worker: Worker | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > Math.ceil(ORGANIZATION_LIMITS.documentBytes / 3) * 4 + 1024)
          throw new Error("TOO_LARGE");
        chunks.push(chunk);
      }
      const input = inputSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      const bytes = Buffer.from(input.base64, "base64");
      if (
        bytes.toString("base64") !== input.base64 ||
        bytes.length > ORGANIZATION_LIMITS.documentBytes
      )
        throw new Error("INVALID_DOCUMENT");
      worker = new Worker(new URL("./document-parser.js", import.meta.url), {
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      worker.stdout.resume();
      worker.stderr.resume();
      const ownedWorker = worker;
      response.on("close", () => {
        void ownedWorker.terminate();
      });
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          void ownedWorker.terminate();
          reject(new Error("TIMEOUT"));
        }, 10000);
        const settle = (work: () => void) => {
          clearTimeout(timer);
          work();
        };
        ownedWorker.once("message", (value) => settle(() => resolve(value)));
        ownedWorker.once("error", () =>
          settle(() => reject(new Error("EXTRACTION_FAILED"))),
        );
        ownedWorker.once("exit", () =>
          settle(() => reject(new Error("EXTRACTION_FAILED"))),
        );
        ownedWorker.postMessage({ bytes, format: input.format });
      });
      const output = z
        .object({
          text: z.string().min(1).max(ORGANIZATION_LIMITS.extractedBytes),
        })
        .strict()
        .parse(result);
      if (Buffer.byteLength(output.text) > ORGANIZATION_LIMITS.extractedBytes)
        throw new Error("TOO_LARGE");
      response.end(JSON.stringify(output));
    } catch {
      if (!response.destroyed)
        response.writeHead(422).end('{"error":"DOCUMENT_UNSUPPORTED"}');
    } finally {
      await worker?.terminate();
      active = false;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}
if (isMainModule(import.meta.url)) {
  const server = createDocumentConverter();
  server.listen(8796, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => server.close());
}
