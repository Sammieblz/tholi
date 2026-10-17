// @vitest-environment node
import { createServer } from "node:http";
import { describe, it, expect, vi } from "vitest";
import {
  createConsentAnalytics,
  createFetchAnalyticsProvider,
} from "../../../apps/web/src/features/preferences/analytics";
import { createConsent } from "../../../apps/web/src/features/preferences/cookies";

describe("consent-gated analytics transport", () => {
  it("sends only sanitized events to a real local endpoint after matching opt-in", async () => {
    const requests: {
      path: string;
      body: unknown;
      cookie: string | undefined;
    }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        path: request.url!,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        cookie: request.headers.cookie,
      });
      response.writeHead(204).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing test endpoint");
    const boundary = createConsentAnalytics(
      createFetchAnalyticsProvider({
        id: "local-test",
        disclosure: "review-1",
        endpoint: `http://127.0.0.1:${address.port}/test/analytics`,
      }),
    );
    try {
      boundary.track({ name: "download_click" });
      boundary.setConsent(createConsent(true));
      boundary.track({ name: "page_view", page: "home" });
      expect(requests).toEqual([]);
      boundary.setConsent({
        ...createConsent(true),
        analytics: {
          provider: "local-test",
          disclosure: "review-1",
          allowed: true,
        },
      });
      boundary.track({ name: "page_view", page: "docs" });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toEqual({
        path: "/test/analytics",
        body: { name: "page_view", page: "docs" },
        cookie: undefined,
      });
      boundary.setConsent(createConsent(false));
      boundary.track({ name: "download_click" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(requests).toHaveLength(1);
    } finally {
      boundary.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
