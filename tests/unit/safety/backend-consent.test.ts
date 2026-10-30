import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import backendDataPermissions from "../../../config/backend-data-permissions.json";
import {
  hasBackendAccess,
  requestBackendAccess,
} from "../../../apps/extension/src/platform/site-access";
import {
  backendNlp,
  backendOcr,
  deleteBackendMemory,
  setBackendSettings,
} from "../../../apps/extension/src/platform/backend-client";
import { fixture } from "../../integration/nlp/fixtures";
import type { RecognitionInput } from "../../../packages/vision/contracts";

const settings = {
  enabled: true,
  url: "https://api.example.test",
  token: "test-token-for-consent-contract-only-0000",
};
const privateSettings = vi.hoisted(() => ({
  getPrivateSetting: vi.fn(),
  setPrivateSetting: vi.fn(),
}));
vi.mock(
  "../../../apps/extension/src/platform/private-settings",
  () => privateSettings,
);
const contains = vi.fn(),
  request = vi.fn(),
  fetch = vi.fn();
const captureGuard = vi.fn<() => Promise<void>>();
beforeEach(() => {
  privateSettings.getPrivateSetting.mockResolvedValue(settings);
  contains.mockResolvedValue(false);
  request.mockResolvedValue(true);
  captureGuard.mockResolvedValue(undefined);
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "moz-extension://consent-test/" },
    permissions: { contains, request },
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const input = () => ({
  requestId: "consent-test",
  documentId: "document",
  revision: 1,
  protocolVersion: 2 as const,
  text: "Show appearance",
  strategy: "fastest" as const,
  observation: fixture(),
});

test("Firefox requests backend host and declared optional data consent in the user gesture", async () => {
  const pending = requestBackendAccess(settings.url);
  expect(request).toHaveBeenCalledWith({
    origins: [settings.url + "/*"],
    data_collection: backendDataPermissions,
  });
  await expect(pending).resolves.toBe(true);
});

test("denied or revoked Firefox consent prevents planning, OCR and mirror deletion requests", async () => {
  await expect(backendNlp(input(), false)).rejects.toThrow(/permission/);
  await expect(
    backendOcr({} as RecognitionInput, undefined, captureGuard),
  ).rejects.toThrow(/permission/);
  await expect(deleteBackendMemory("https://example.test")).rejects.toThrow(
    /permission/,
  );
  await expect(setBackendSettings(settings)).rejects.toThrow(/transmission/);
  expect(fetch).not.toHaveBeenCalled();
  expect(privateSettings.setPrivateSetting).not.toHaveBeenCalled();
});

test("revocation between backend capability discovery and OCR prevents sending image bytes", async () => {
  contains.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ capabilities: ["cpu-ocr"] }),
  });
  await expect(
    backendOcr(
      { image: "private-image-must-not-be-sent" } as RecognitionInput,
      undefined,
      captureGuard,
    ),
  ).rejects.toThrow(/permission/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(settings.url + "/v2/health");
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
  expect(captureGuard).not.toHaveBeenCalled();
});

test("Chromium keeps its existing backend host request without Firefox data fields", async () => {
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "chrome-extension://consent-test/" },
    permissions: { contains, request },
  });
  await expect(requestBackendAccess(settings.url)).resolves.toBe(true);
  expect(request).toHaveBeenCalledWith({ origins: [settings.url + "/*"] });
  await expect(hasBackendAccess(settings.url)).resolves.toBe(false);
  contains.mockResolvedValue(true);
  await expect(hasBackendAccess(settings.url)).resolves.toBe(true);
  expect(contains).toHaveBeenCalledWith({ origins: [settings.url + "/*"] });
});

test("OCR checks capture freshness after capability and consent awaits, before sending any image", async () => {
  contains.mockResolvedValue(true);
  let release: (() => void) | undefined;
  fetch.mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ok: true, json: async () => ({ capabilities: ["cpu-ocr"] }) };
  });
  const controller = new AbortController();
  captureGuard.mockImplementation(async () => {
    controller.abort();
    controller.signal.throwIfAborted();
  });
  const result = backendOcr(
    {} as RecognitionInput,
    controller.signal,
    captureGuard,
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(captureGuard).not.toHaveBeenCalled();
  release!();
  await expect(result).rejects.toThrow();
  expect(captureGuard).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(settings.url + "/v2/health");
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});

test("changed saved connections block OCR and a current connection accepts only a prepared PNG", async () => {
  contains.mockResolvedValue(true);
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ capabilities: ["cpu-ocr"] }),
  });
  privateSettings.getPrivateSetting
    .mockResolvedValueOnce(settings)
    .mockResolvedValueOnce({ ...settings, enabled: false });
  await expect(
    backendOcr({} as RecognitionInput, undefined, captureGuard),
  ).rejects.toThrow(/connection changed/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(captureGuard).not.toHaveBeenCalled();
  privateSettings.getPrivateSetting.mockResolvedValue(settings);
  fetch.mockClear();
  await expect(
    backendOcr(
      { image: "raw-data-url" } as RecognitionInput,
      undefined,
      captureGuard,
    ),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  const input: RecognitionInput = {
    requestId: crypto.randomUUID(),
    journeyId: crypto.randomUUID(),
    captureId: crypto.randomUUID(),
    documentId: "native-document",
    contextRevision: 1,
    observationRevision: 1,
    viewportRevision: 1,
    image: readFileSync("tests/fixtures/vision/light.png").toString("base64"),
    width: 640,
    height: 180,
    cssWidth: 640,
    cssHeight: 180,
  };
  fetch.mockClear();
  await backendOcr(input, undefined, captureGuard);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe(settings.url + "/v2/ocr");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(input);
});

test("an authorized backend request uses the saved endpoint and token, then stops after revocation", async () => {
  contains.mockResolvedValue(true);
  fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  await deleteBackendMemory("https://example.test");
  expect(fetch).toHaveBeenCalledWith(
    settings.url + "/v1/forget",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer " + settings.token,
      }),
      body: JSON.stringify({ origin: "https://example.test" }),
    }),
  );
  contains.mockResolvedValue(false);
  await expect(deleteBackendMemory("https://example.test")).rejects.toThrow(
    /permission/,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
