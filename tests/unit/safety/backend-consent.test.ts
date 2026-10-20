import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
beforeEach(() => {
  privateSettings.getPrivateSetting.mockResolvedValue(settings);
  contains.mockResolvedValue(false);
  request.mockResolvedValue(true);
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
  await expect(backendOcr({} as RecognitionInput)).rejects.toThrow(
    /permission/,
  );
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
    backendOcr({ image: "private-image-must-not-be-sent" } as RecognitionInput),
  ).rejects.toThrow(/permission/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(settings.url + "/v2/health");
  expect(fetch.mock.calls[0][1].body).toBeUndefined();
});

test("Chromium keeps its existing backend host request without Firefox data fields", async () => {
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "chrome-extension://consent-test/" },
    permissions: { contains, request },
  });
  await expect(requestBackendAccess(settings.url)).resolves.toBe(true);
  expect(request).toHaveBeenCalledWith({ origins: [settings.url + "/*"] });
  await expect(hasBackendAccess(settings.url)).resolves.toBe(true);
  expect(contains).not.toHaveBeenCalled();
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
