import { createServer, type IncomingMessage, type Server } from "node:http";
import { z } from "zod";
import {
  ORGANIZATION_LIMITS,
  publicDocumentationCrawlSchema,
} from "../../../../packages/navigation-core/contracts-organization";
import type { PublicDocumentationCrawler } from "../application/organization";
import { isMainModule } from "../runtime";
import { createPublicDocumentationCrawler } from "./public-documentation-crawler";

const fetchedPageSchema = z
  .object({
    url: z.string().url().max(2048),
    title: z.string().max(120),
    html: z.string().max(ORGANIZATION_LIMITS.crawlPageBytes),
  })
  .strict();
const internalResultSchema = z
  .object({
    documents: z.array(fetchedPageSchema).max(ORGANIZATION_LIMITS.crawlPages),
    visited: z.number().int().min(0).max(ORGANIZATION_LIMITS.crawlSitemapUrls),
    skipped: z.number().int().min(0).max(ORGANIZATION_LIMITS.crawlSitemapUrls),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (
      result.documents.some(
        (page) =>
          Buffer.byteLength(page.html, "utf8") >
          ORGANIZATION_LIMITS.crawlPageBytes,
      )
    )
      ctx.addIssue({ code: "custom", message: "Fetched page exceeds its byte budget." });
  });

function requestLimit(request: IncomingMessage, maxBytes: number) {
  return (async () => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw Error("REQUEST_TOO_LARGE");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  })();
}

function writeJson(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

/** Internal-only service. It is the sole component with public network egress. */
export function createPublicDocumentationFetcherServer(
  crawler: PublicDocumentationCrawler = createPublicDocumentationCrawler(),
): Server {
  let active = false;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health/ready") {
      writeJson(response, 200, { ready: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/crawl") {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return;
    }
    if (active) {
      writeJson(response, 429, { error: "BUSY" });
      return;
    }
    active = true;
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const input = publicDocumentationCrawlSchema.parse(
        JSON.parse(await requestLimit(request, 4096)),
      );
      const result = internalResultSchema.parse(
        await crawler.crawl(input, AbortSignal.any([
          controller.signal, AbortSignal.timeout(30_000),
        ])),
      );
      if (!response.destroyed) writeJson(response, 200, result);
    } catch {
      if (!response.destroyed) writeJson(response, 422, { error: "CRAWL_FAILED" });
    } finally {
      active = false;
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

/** API-side client; only the isolated fetcher can reach public destinations. */
export function createRemotePublicDocumentationCrawler(
  origin: string,
): PublicDocumentationCrawler {
  const endpoint = new URL("/crawl", origin);
  return {
    async crawl(input, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok || !response.body)
          throw Error("PUBLIC_CRAWLER_UNAVAILABLE");
        const maxBytes =
          ORGANIZATION_LIMITS.crawlPages * ORGANIZATION_LIMITS.crawlPageBytes * 4 +
          64 * 1024;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel();
            throw Error("PUBLIC_CRAWLER_RESPONSE_TOO_LARGE");
          }
          chunks.push(value);
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
        );
        return internalResultSchema.parse(JSON.parse(text));
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}

if (isMainModule(import.meta.url)) {
  const server = createPublicDocumentationFetcherServer();
  server.listen(8797, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => server.close());
}
