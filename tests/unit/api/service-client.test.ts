import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  serviceOrigin,
  serviceRequest,
} from "../../../packages/navigation-core/service-client";
const fetchMock = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
