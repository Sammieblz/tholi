// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";
import { SERVICE_LIMITS } from "../../../packages/navigation-core/contracts-service";
import { SUPPORT_LIMITS } from "../../../packages/navigation-core/contracts-support";

const config = vi.hoisted(() => ({
  origin: "https://api.example.test" as string | undefined,
}));
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../apps/web/src/config/project", () => ({
  publicOrigin: "https://tholi.io",
  get serviceApiOrigin() {
    return config.origin;
  },
}));
vi.mock(
  "../../../packages/navigation-core/service-client",
  async (original) => ({
    ...(await original<
      typeof import("../../../packages/navigation-core/service-client")
    >()),
    serviceRequest: transport.request,
  }),
);
import { ContactPage } from "../../../apps/web/src/features/support/ContactPage";
import { ServiceClientError } from "../../../packages/navigation-core/service-client";

const id = (last: number) =>
  `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
const session = {
  account: { id: id(1), workspaceId: id(2), revision: "1" },
  session: {
    id: id(3),
    clientId: "web",
    clientKind: "web",
    expiresAt: "2030-01-01T00:00:00.000Z",
  },
  csrfToken: "c".repeat(43),
};
const capabilities = {
  protocol: "tholi-service",
  version: 1,
  implementationVersion: "0.11.0",
  supportedVersions: [1],
  capabilities: ["capabilities", "support-requests", "private-files"],
  availability: {
    authentication: true,
    accountData: true,
    decisions: false,
    billing: false,
  },
  limits: SERVICE_LIMITS,
};
const saved = {
  id: id(4),
  operatorJobId: id(5),
  receiptJobId: null,
  expiresAt: "2030-01-01T00:00:00.000Z",
};
const file = {
  id: id(6),
  requestId: id(7),
  revision: "1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  status: "ready",
};
const snapshot = {
  schemaVersion: 1,
  version: "0.11.0",
  profile: "service",
  accountStatus: "active",
  workspaceKind: "personal",
  role: "owner",
  jobs: {
    queued: 1,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    cancelled: 0,
    uncertain: 0,
  },
};
let root: Root;
let container: HTMLDivElement;
let supportFailure = false;
let metadataFailure = false;
let diagnosticFailure = false;
let hostileLink = false;
let downloadUnauthorized = false;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("FormData", window.FormData);
  config.origin = "https://api.example.test";
  supportFailure = metadataFailure = hostileLink = downloadUnauthorized = false;
  diagnosticFailure = false;
  transport.request.mockImplementation(
    async (_origin: string, path: string, schema: z.ZodTypeAny) => {
      let response: unknown;
      if (path === "/api/v1/account") response = session;
      else if (path === "/api/v1/capabilities") response = capabilities;
      else if (path === "/api/v1/support/requests") {
        if (supportFailure)
          throw new ServiceClientError("RATE_LIMITED", 429, "Try again later.");
        response = saved;
      } else if (path === "/api/v1/account/diagnostic-exports") {
        if (diagnosticFailure)
          throw new ServiceClientError("UNAVAILABLE", 503, "Try again later.");
        response = { requestId: file.requestId, jobId: id(8), fileId: file.id };
      } else if (path === `/api/v1/account/files/${file.id}`) {
        if (metadataFailure)
          throw new ServiceClientError("UNAVAILABLE", 503, "Try again later.");
        response = file;
      } else if (path === `/api/v1/account/files/${file.id}/link`)
        response = {
          url: `${hostileLink ? "https://untrusted.example.test" : config.origin}/api/v1/account/files/${file.id}/download?token=signed.proof`,
          expiresAt: new Date(
            Date.now() + SUPPORT_LIMITS.maxLinkLifetimeMs,
          ).toISOString(),
        };
      else if (
        path === `/api/v1/account/files/${file.id}/download?token=signed.proof`
      ) {
        if (downloadUnauthorized)
          throw new ServiceClientError(
            "UNAUTHENTICATED",
            401,
            "Sign in again.",
          );
        response = snapshot;
      } else throw new Error("Unexpected support test operation.");
      return schema.parse(response);
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(createElement(ContactPage)));
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function fill() {
  for (const [name, value] of Object.entries({
    email: "reply@example.test",
    subject: "Open Tholi",
    message: "Please help me open the panel.",
  }))
    (container.querySelector(`[name="${name}"]`) as HTMLInputElement).value =
      value;
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("keeps the Local email draft account-free and uses the shared field limits", async () => {
  config.origin = undefined;
  await mount();
  expect(transport.request).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Nothing is sent by this form.");
  for (const name of ["name", "email", "subject", "message"] as const)
    expect(
      container.querySelector(`[name="${name}"]`)!.getAttribute("maxlength"),
    ).toBe(String(SUPPORT_LIMITS[name]));
  fill();
  await submit();
  expect(container.textContent).toContain("Your message is ready to email.");
  expect(container.querySelector('a[href^="mailto:"]')).toBeTruthy();
  expect(document.activeElement?.id).toBe("contact-draft-title");
  expect(transport.request).not.toHaveBeenCalled();
});

it("submits only on explicit action, reuses a payload-bound retry key and announces saved/queued rather than delivered", async () => {
  await mount();
  expect(transport.request.mock.calls.map((call) => call[1])).toEqual([
    "/api/v1/account",
    "/api/v1/capabilities",
  ]);
  fill();
  supportFailure = true;
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Try again later.",
  );
  supportFailure = false;
  await submit();
  const submissions = transport.request.mock.calls.filter(
    (call) => call[1] === "/api/v1/support/requests",
  );
  expect(submissions).toHaveLength(2);
  expect(submissions[0][3].body.idempotencyKey).toBe(
    submissions[1][3].body.idempotencyKey,
  );
  expect(submissions[1][3]).toMatchObject({
    method: "POST",
    credentials: "include",
    headers: { "X-Tholi-CSRF": session.csrfToken },
  });
  expect(submissions[1][3].body).not.toHaveProperty("accountId");
  expect(container.textContent).toContain(
    "does not confirm that an email reached an inbox",
  );
  expect(document.activeElement?.id).toBe("contact-saved-title");
  expect(
    transport.request.mock.calls.some((call) =>
      call[1].includes("diagnostic-exports"),
    ),
  ).toBe(false);
});

it("keeps diagnostic retries idempotent, validates download destinations and removes private controls when authentication expires", async () => {
  await mount();
  diagnosticFailure = true;
  await click("Create account diagnostic");
  diagnosticFailure = false;
  metadataFailure = true;
  await click("Create account diagnostic");
  const exports = transport.request.mock.calls.filter(
    (call) => call[1] === "/api/v1/account/diagnostic-exports",
  );
  expect(exports).toHaveLength(2);
  expect(exports[0][3].body.idempotencyKey).toBe(
    exports[1][3].body.idempotencyKey,
  );
  metadataFailure = false;
  await click("Check diagnostic status");
  expect(
    transport.request.mock.calls.filter(
      (call) => call[1] === "/api/v1/account/diagnostic-exports",
    ),
  ).toHaveLength(2);
  hostileLink = true;
  await click("Download diagnostic");
  expect(container.textContent).toContain(
    "This request could not be completed. Try again when you are ready.",
  );
  expect(
    transport.request.mock.calls.some((call) => call[1].includes("/download?")),
  ).toBe(false);
  hostileLink = false;
  const OriginalURL = URL;
  const createObjectURL = vi.fn(() => "blob:approved-diagnostic");
  vi.stubGlobal(
    "URL",
    Object.assign(class extends OriginalURL {}, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    }),
  );
  const nativeDownload = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await click("Download diagnostic");
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(nativeDownload).toHaveBeenCalledOnce();
  expect(container.textContent).toContain(
    "has not been attached to a support request",
  );
  downloadUnauthorized = true;
  await click("Download diagnostic");
  expect(container.textContent).toContain("Nothing is sent by this form.");
  expect(container.querySelector(".contact-diagnostic")).toBeNull();
  expect(container.textContent).not.toContain("Your diagnostic is ready");
});
