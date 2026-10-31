import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ServiceClientError,
  serviceOrigin,
  serviceRequest,
} from "../../../packages/navigation-core/service-client";
import { NAVIGATION_TRANSPORT_LIMITS } from "../../../packages/navigation-core/contracts-navigation";
import { SERVICE_LIMITS } from "../../../packages/navigation-core/contracts-service";
const fetchMock = vi.fn();
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

const decisions =
  "/api/v1/workspaces/10000000-0000-4000-8000-000000000001/decisions";
const responseSchema = z.object({ ok: z.literal(true) }).strict();

it("raises only the explicit decision POST upload bound and transmits a shortened deadline", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => Response.json({ ok: true }));
  const body = { synthetic: "x".repeat(SERVICE_LIMITS.maxBodyBytes) };
  await expect(
    serviceRequest(
      "https://api.example.test",
      "/api/v1/account",
      responseSchema,
      {
        method: "POST",
        body,
      },
    ),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(
    serviceRequest("https://api.example.test", decisions, responseSchema, {
      profile: "navigation",
      method: "POST",
      body,
      timeoutMs: 1200,
    }),
  ).resolves.toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const forwardedTimeout = Number(
    fetchMock.mock.calls[0][1].headers["x-tholi-timeout-ms"],
  );
  expect(forwardedTimeout).toBeGreaterThan(0);
  expect(forwardedTimeout).toBeLessThanOrEqual(1200);
});

it.each([75, 1200])(
  "counts %s ms spent in the final guard against the original deadline",
  async (elapsedMs) => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => Response.json({ ok: true }));
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const request = serviceRequest(
      "https://api.example.test",
      decisions,
      responseSchema,
      {
        profile: "navigation",
        method: "POST",
        timeoutMs: 1200,
        beforeSend: async () => {
          clock.mockReturnValue(1000 + elapsedMs);
        },
      },
    );
    if (elapsedMs === 1200) {
      await expect(request).rejects.toMatchObject({
        code: "DEADLINE_EXCEEDED",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } else {
      await expect(request).resolves.toEqual({ ok: true });
      expect(fetchMock.mock.calls[0][1].headers["x-tholi-timeout-ms"]).toBe(
        String(1200 - elapsedMs),
      );
    }
  },
);

it.each([
  ["/api/v1/account", "POST"],
  [decisions, "GET"],
  [decisions + "?upload=1", "POST"],
  [decisions + "/10000000-0000-4000-8000-000000000002/cancel", "POST"],
  ["/api/v1/workspaces/not-a-workspace/decisions", "POST"],
] as const)(
  "refuses the navigation profile on %s %s before any send",
  async (path, method) => {
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      serviceRequest(
        "https://api.example.test",
        path as `/api/v1/${string}`,
        responseSchema,
        {
          profile: "navigation",
          method,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("refuses oversized encoded navigation bodies before the final send guard", async () => {
  vi.stubGlobal("fetch", fetchMock);
  const beforeSend = vi.fn(async () => {});
  await expect(
    serviceRequest("http://127.0.0.1:8788", decisions, responseSchema, {
      profile: "navigation",
      method: "POST",
      body: {
        synthetic: "界".repeat(
          Math.ceil(NAVIGATION_TRANSPORT_LIMITS.maxBodyBytes / 3),
        ),
      },
      beforeSend,
    }),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  expect(beforeSend).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("aborts an awaited final guard and never dispatches when that guard later completes", async () => {
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  let complete!: () => void;
  const guard = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const beforeSend = vi.fn(() => guard);
  const request = serviceRequest(
    "https://api.example.test",
    decisions,
    responseSchema,
    {
      profile: "navigation",
      method: "POST",
      signal: controller.signal,
      beforeSend,
    },
  );
  await vi.waitFor(() => expect(beforeSend).toHaveBeenCalledOnce());
  controller.abort();
  await expect(request).rejects.toMatchObject({ code: "CANCELLED" });
  complete();
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps a specific revoked-consent error from the final guard and sends no bytes", async () => {
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    serviceRequest("https://api.example.test", decisions, responseSchema, {
      profile: "navigation",
      method: "POST",
      beforeSend: async () => {
        throw new ServiceClientError(
          "FORBIDDEN",
          0,
          "Cloud processing permission was withdrawn.",
        );
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("cancels a stalled response reader without waiting for an uncooperative source cleanup", async () => {
  vi.stubGlobal("fetch", fetchMock);
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull, cancel });
  fetchMock.mockResolvedValue(
    new Response(body, { headers: { "Content-Type": "application/json" } }),
  );
  const controller = new AbortController();
  const request = serviceRequest(
    "https://api.example.test",
    decisions,
    responseSchema,
    {
      profile: "navigation",
      method: "POST",
      signal: controller.signal,
    },
  );
  await vi.waitFor(() => expect(pull).toHaveBeenCalled());
  controller.abort();
  await expect(request).rejects.toMatchObject({ code: "CANCELLED" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("bounds an uncooperative fetch by the shortened navigation deadline without retrying", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
  await expect(
    serviceRequest("https://api.example.test", decisions, responseSchema, {
      profile: "navigation",
      method: "POST",
      timeoutMs: 20,
    }),
  ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each([0, SERVICE_LIMITS.maxDeadlineMs + 1])(
  "cannot widen or invalidate the service deadline with %s",
  async (timeoutMs) => {
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      serviceRequest("https://api.example.test", decisions, responseSchema, {
        profile: "navigation",
        method: "POST",
        timeoutMs,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it.each(["QUOTA_EXCEEDED", "FORBIDDEN", "UNAVAILABLE"] as const)(
  "preserves %s without retrying or opening checkout",
  async (code) => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code,
            requestId: "10000000-0000-4000-8000-000000000002",
            message: "The request is unavailable.",
            retryable: false,
          },
        },
        {
          status:
            code === "FORBIDDEN" ? 403 : code === "QUOTA_EXCEEDED" ? 429 : 503,
        },
      ),
    );
    await expect(
      serviceRequest("https://api.example.test", decisions, responseSchema, {
        profile: "navigation",
        method: "POST",
      }),
    ).rejects.toMatchObject({ code, retryable: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  },
);

it("keeps the guidance response budget smaller than the unchanged account response budget", async () => {
  vi.stubGlobal("fetch", fetchMock);
  const payload = {
    ok: true,
    detail: "x".repeat(NAVIGATION_TRANSPORT_LIMITS.maxResponseBytes),
  };
  const schema = z.object({ ok: z.literal(true), detail: z.string() }).strict();
  fetchMock.mockImplementation(async () => Response.json(payload));
  await expect(
    serviceRequest("https://api.example.test", "/api/v1/account", schema),
  ).resolves.toEqual(payload);
  await expect(
    serviceRequest("https://api.example.test", decisions, schema, {
      profile: "navigation",
      method: "POST",
    }),
  ).rejects.toBeInstanceOf(ServiceClientError);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("accepts only canonical HTTPS and explicit loopback service origins", () => {
  for (const value of [
    "https://api.example.test",
    "http://127.0.0.1:8788",
    "http://localhost:8788",
    "http://[::1]:8788",
  ])
    expect(serviceOrigin(value)).toBe(value);
  for (const value of [
    "http://api.example.test",
    "https://api.example.test/",
    "https://user:secret@api.example.test",
    "https://api.example.test/path",
    "https://api.example.test?token=secret",
    "https://api.example.test#account",
  ])
    expect(() => serviceOrigin(value)).toThrow();
});
it("keeps API requests bounded, same-origin, uncached and independent of account credential storage", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  await expect(
    serviceRequest(
      "https://api.example.test",
      "/api/v1/account",
      z.object({ ok: z.literal(true) }).strict(),
      { credentials: "include" },
    ),
  ).resolves.toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.test/api/v1/account",
    expect.objectContaining({
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    }),
  );
  await expect(
    serviceRequest(
      "https://api.example.test",
      "/api/v1/../../secret" as `/api/v1/${string}`,
      z.unknown(),
    ),
  ).rejects.toThrow("Invalid service request");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects oversized or invalid responses without exposing their body", async () => {
  vi.stubGlobal("fetch", fetchMock);
  for (const response of [
    new Response("PRIVATE_RESPONSE"),
    new Response(JSON.stringify({ unexpected: "PRIVATE_RESPONSE" })),
    new Response("PRIVATE_RESPONSE".repeat(40_000)),
  ]) {
    fetchMock.mockResolvedValueOnce(response);
    try {
      await serviceRequest(
        "https://api.example.test",
        "/api/v1/account",
        z.object({ ok: z.boolean() }).strict(),
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_RESPONSE");
      expect(String(error)).not.toContain("Expected rejection");
    }
  }
});
