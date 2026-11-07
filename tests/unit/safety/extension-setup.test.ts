import { afterEach, beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ value: undefined as unknown }));
const auth = vi.hoisted(() => ({
  serviceAuthCommand: vi.fn(),
  cancelPendingServiceSignIn: vi.fn(),
  servicePlanCatalog: vi.fn(),
  activateSetupPlan: vi.fn(),
}));
vi.mock("../../../apps/extension/src/platform/private-settings", () => ({
  getPrivateSetting: async () => store.value,
  setPrivateSetting: async (_key: string, value: unknown) => {
    store.value = value;
  },
}));
vi.mock("../../../apps/extension/src/platform/service-auth", () => auth);
const create = vi.fn(),
  query = vi.fn(),
  update = vi.fn();
beforeEach(() => {
  store.value = undefined;
  vi.stubGlobal("browser", {
    runtime: {
      id: "setup-test",
      getURL: (file: string) => `moz-extension://setup-test/${file}`,
    },
    tabs: { create, query, update },
    windows: { update: vi.fn() },
  });
  query.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
import {
  setupInstalled,
  setupStatus,
  setupCommand,
  isWelcome,
} from "../../../apps/extension/src/background/setup-service";

it("fresh installation opens one packaged welcome tab, while updates, restarts and retained installations do not", async () => {
  expect(await setupStatus()).toEqual({ version: 1, complete: true, step: 1 });
  await setupInstalled("update");
  expect(create).not.toHaveBeenCalled();
  await Promise.all([setupInstalled("install"), setupInstalled("install")]);
  expect(create).toHaveBeenCalledExactlyOnceWith({
    url: "moz-extension://setup-test/welcome.html",
  });
  expect(await setupStatus()).toEqual({ version: 1, complete: false, step: 1 });
  await setupCommand({ type: "SETUP_STEP", step: 3 });
  expect((await setupStatus()).step).toBe(3);
  await setupInstalled("browser_update");
  expect(create).toHaveBeenCalledTimes(1);
});
it("local completion fences pending sign-in and disables transmission without granting an account", async () => {
  await setupInstalled("install");
  const next = await setupCommand({ type: "SETUP_COMPLETE", choice: "local" });
  expect(auth.cancelPendingServiceSignIn).toHaveBeenCalledOnce();
  expect(auth.serviceAuthCommand).toHaveBeenCalledExactlyOnceWith({
    type: "AUTH_INFERENCE_CONFIGURE",
    profile: "fake",
    enabled: false,
    images: false,
  });
  expect(next).toMatchObject({ complete: true, choice: "local" });
  await setupInstalled("update");
  expect(create).toHaveBeenCalledTimes(1);
});
it("account completion requires current native metadata and rejects client-supplied session claims", async () => {
  auth.serviceAuthCommand.mockResolvedValue({ configured: false });
  await expect(
    setupCommand({ type: "SETUP_COMPLETE", choice: "account" }),
  ).rejects.toThrow("Complete sign-in");
  await expect(
    setupCommand({
      type: "SETUP_COMPLETE",
      choice: "account",
      account: { id: "injected" },
    }),
  ).rejects.toThrow();
  expect(store.value).toBeUndefined();
});
it("the welcome sender must be the exact top-level packaged page from this extension", () => {
  const sender = {
    id: "setup-test",
    url: "moz-extension://setup-test/welcome.html",
    frameId: 0,
  };
  expect(isWelcome(sender)).toBe(true);
  for (const change of [
    { id: "other" },
    { frameId: 1 },
    { url: sender.url + "?spoof=1" },
    { url: "https://tholi.io/welcome" },
  ])
    expect(isWelcome({ ...sender, ...change })).toBe(false);
});

it("retains a versioned plan preference through introduction progress and requires explicit verified activation", async () => {
  await setupInstalled("install");
  await setupCommand({
    type: "SETUP_SELECT",
    planIntent: { mode: "free-cloud" },
  });
  await setupCommand({ type: "SETUP_STEP", step: 3 });
  expect(await setupStatus()).toMatchObject({
    version: 1,
    complete: false,
    step: 3,
    planIntent: { mode: "free-cloud" },
  });
  expect(auth.activateSetupPlan).not.toHaveBeenCalled();
  auth.serviceAuthCommand.mockResolvedValue({
    configured: true,
    account: {
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      revision: "1",
    },
  });
  await expect(
    setupCommand({ type: "SETUP_COMPLETE", choice: "account" }),
  ).rejects.toThrow("Review the selected plan");
  await setupCommand({ type: "SETUP_ACTIVATE", images: false });
  expect(auth.activateSetupPlan).toHaveBeenCalledWith(
    { mode: "free-cloud" },
    false,
    expect.any(Function),
  );
  expect(await setupStatus()).toMatchObject({
    complete: true,
    choice: "account",
  });
  await setupInstalled("update");
  expect(create).toHaveBeenCalledTimes(1);
});

it("Local immediately fences delayed activation and survives its late result", async () => {
  await setupCommand({
    type: "SETUP_SELECT",
    planIntent: { mode: "free-cloud" },
  });
  let finish!: () => void;
  auth.activateSetupPlan.mockImplementation(async (_intent, _images, check) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    check();
  });
  const activating = setupCommand({ type: "SETUP_ACTIVATE", images: false });
  const rejected = expect(activating).rejects.toThrow("setup choice changed");
  await vi.waitFor(() => expect(finish).toBeDefined());
  auth.serviceAuthCommand.mockClear();
  const local = setupCommand({ type: "SETUP_COMPLETE", choice: "local" });
  expect(auth.cancelPendingServiceSignIn).toHaveBeenCalled();
  expect(auth.serviceAuthCommand).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false, images: false }),
  );
  finish();
  await rejected;
  await local;
  expect(await setupStatus()).toMatchObject({
    complete: true,
    choice: "local",
    planIntent: { mode: "local" },
  });
});

it("paid intent and forged setup claims cannot enable processing or grant checkout", async () => {
  const planIntent = { mode: "paid", planId: "paid-cloud", planVersion: 1 };
  await setupCommand({ type: "SETUP_SELECT", planIntent });
  await expect(
    setupCommand({ type: "SETUP_ACTIVATE", images: false }),
  ).rejects.toThrow("Choose Free Cloud");
  await expect(
    setupCommand({
      type: "SETUP_ACTIVATE",
      images: false,
      entitlement: "active",
    }),
  ).rejects.toThrow();
  expect(auth.activateSetupPlan).not.toHaveBeenCalled();
  expect(await setupStatus()).toMatchObject({ complete: false, planIntent });
});
