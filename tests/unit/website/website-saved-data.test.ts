// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  emptySavedDataClientState,
  type SavedDataClientState,
} from "../../../packages/navigation-core/saved-data-client";
import {
  savedDataArtifactFixture,
  savedDataRecordFixture,
} from "../../support/saved-data-fixture";
import type { SavedDataRecord } from "../../../packages/navigation-core/contracts-saved-data";
const state = vi.hoisted(() => ({ account: undefined as unknown }));
vi.mock("../../../apps/web/src/features/account/session", () => ({
  useAccount: () => state.account,
}));
vi.mock("../../../apps/web/src/features/account/AccountFileDelivery", () => ({
  AccountFileDelivery: ({ fileId }: { fileId?: string }) =>
    fileId ? createElement("p", null, "Selected export requested") : null,
}));
import { SavedDataPage } from "../../../apps/web/src/features/account/SavedDataPage";
let root: Root, container: HTMLDivElement;
let cache: SavedDataClientState, rows: SavedDataRecord[];
const client = {
  list: vi.fn(),
  read: vi.fn(),
  cached: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  export: vi.fn(),
  reconcile: vi.fn(),
  discardConflict: vi.fn(),
};
const request = vi.fn();
const session = (id: number) => ({
  account: {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    workspaceId: `00000000-0000-4000-8000-${String(id + 1).padStart(12, "0")}`,
    revision: "1",
  },
  session: {
    id: `00000000-0000-4000-8000-${String(id + 2).padStart(12, "0")}`,
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  cache = emptySavedDataClientState();
  rows = (
    [
      "saved_route",
      "site_knowledge",
      "conversation_excerpt",
      "preferences",
    ] as const
  ).map((kind) =>
    savedDataRecordFixture(
      savedDataArtifactFixture(kind, {
        metadata: { label: kind, folder: null, tags: [] },
      }),
    ),
  );
  client.list.mockImplementation(async () => ({
    items: rows,
    nextCursor: undefined,
  }));
  client.read.mockImplementation(async (id: string) =>
    rows.find((row) => row.id === id),
  );
  client.cached.mockImplementation(async () => cache);
  request.mockResolvedValue({
    capabilities: ["saved-data-write", "saved-data-export", "account-binding"],
  });
  state.account = {
    configured: true,
    session: session(1),
    savedData: client,
    request,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function mount() {
  await act(async () => root.render(createElement(SavedDataPage)));
}
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === name,
  )!;
async function click(name: string) {
  await act(async () => button(name).click());
}
async function field(
  label: string,
  value: string,
  within: Element = container,
) {
  const element = [...within.querySelectorAll("label")]
    .find((node) => node.firstChild?.textContent === label)
    ?.querySelector("input,textarea,select") as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
  return element;
}
async function submit(selector: string) {
  await act(async () =>
    container
      .querySelector(selector)!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("lists every approved kind, reads details only on request, and filters, pages and exports explicit selections", async () => {
  await mount();
  for (const kind of [
    "saved_route",
    "site_knowledge",
    "conversation_excerpt",
    "preferences",
  ])
    expect(button(`View ${kind}`)).toBeDefined();
  expect(client.read).not.toHaveBeenCalled();
  await field("Search saved data", "Help");
  await field("Type", "saved_route");
  await field("Folder", "Work");
  await field("Tag", "daily");
  client.list.mockResolvedValueOnce({ items: rows, nextCursor: "next-page" });
  await submit(".saved-data-filters");
  expect(client.list).toHaveBeenLastCalledWith(
    {
      limit: 20,
      cursor: undefined,
      query: "Help",
      kind: "saved_route",
      folder: "Work",
      tag: "daily",
    },
    true,
  );
  await click("Next page");
  expect(client.list.mock.calls.at(-1)?.[0].cursor).toBe("next-page");
  await click("Previous page");
  expect(client.list.mock.calls.at(-1)?.[0].cursor).toBeUndefined();
  const selection = container.querySelector<HTMLInputElement>(
    `input[aria-label="Select saved_route"]`,
  )!;
  await act(async () => selection.click());
  const requested = {
    requestId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    fileId: crypto.randomUUID(),
  };
  client.export.mockResolvedValueOnce(requested);
  await click("Export selected");
  expect(client.export).toHaveBeenCalledWith([rows[0].id]);
  expect(container.textContent).toContain("Selected export requested");
  await click("View conversation_excerpt");
  expect(client.read).toHaveBeenCalledOnce();
  expect(
    container.querySelector(".saved-data-conversation")?.textContent,
  ).toContain("Find Help");
  expect(document.activeElement?.id).toBe("saved-data-detail-title");
  await click("Close details");
  expect(document.activeElement).toBe(button("View conversation_excerpt"));
});

it("edits only approved route and preference fields while preserving static history and base revisions", async () => {
  await mount();
  await click("View saved_route");
  const editor = container.querySelector(".saved-data-editor")!;
  await field("Label", "Work settings");
  await field("Folder", "Work", editor);
  await field("Tags", "weekly, settings");
  await field("Destination", "Open Help");
  await submit(".saved-data-editor");
  expect(client.save).toHaveBeenCalledWith(
    {
      id: rows[0].id,
      schemaVersion: 1,
      kind: "saved_route",
      metadata: {
        label: "Work settings",
        folder: "Work",
        tags: ["weekly", "settings"],
      },
      data: { ...rows[0].data, goal: "Open Help" },
    },
    rows[0].revision,
  );
  await click("Close details");
  await click("View preferences");
  await field("Saved website appearance", "light");
  await submit(".saved-data-editor");
  expect(client.save.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "preferences",
    data: { websiteAppearance: "light" },
  });
  expect(container.textContent).toContain(
    "does not change this browser's theme",
  );
  let finish!: () => void;
  const search = container.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )!;
  client.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit(".saved-data-editor");
  search.focus();
  rows[3] = savedDataRecordFixture(
    savedDataArtifactFixture("preferences", {
      id: rows[3].id,
      metadata: rows[3].metadata,
      data: { websiteAppearance: "light" },
    }),
    { revision: "2", syncRevision: "2" },
  );
  await act(async () => finish());
  expect(container.querySelector(".saved-data-detail")?.textContent).toContain(
    "Saved website appearance: light",
  );
  expect(document.activeElement).toBe(search);
  client.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit(".saved-data-editor");
  await click("Close details");
  // A native close removes the currently focused button, leaving body.
  // Move off Search to exercise the separate lost-focus restoration path.
  search.blur();
  await act(async () => finish());
  expect(container.querySelector(".saved-data-detail")).toBeNull();
  expect(document.activeElement).toBe(button("View preferences"));
  await click("View preferences");
  client.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit(".saved-data-editor");
  await click("Close details");
  search.focus();
  await act(async () => finish());
  expect(container.querySelector(".saved-data-detail")).toBeNull();
  expect(document.activeElement).toBe(search);
});

it("shows unconfirmed operations without automatic retries and reconciles only after an explicit action", async () => {
  await mount();
  await click("View saved_route");
  client.save.mockImplementationOnce(async () => {
    cache = {
      ...cache,
      outbox: [
        {
          state: "uncertain",
          operation: {
            kind: "save",
            body: {
              idempotencyKey: crypto.randomUUID(),
              expectedRevision: rows[0].revision,
              approved: true,
              artifact: savedDataArtifactFixture("saved_route", {
                id: rows[0].id,
              }),
            },
          },
        },
      ],
    };
    throw new Error("Private provider diagnostic must not render");
  });
  await submit(".saved-data-editor");
  expect(container.textContent).toContain("Not yet confirmed");
  expect(container.textContent).not.toContain("Private provider diagnostic");
  expect(client.reconcile).not.toHaveBeenCalled();
  client.reconcile.mockImplementationOnce(async () => {
    cache = emptySavedDataClientState();
  });
  await click("Reconcile pending changes");
  expect(client.reconcile).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Not yet confirmed");
});

it("failed editing discovery preserves reads and recovers only through an explicit refresh without redundant metadata reads or mutations", async () => {
  request.mockRejectedValueOnce(
    new Error("Private availability diagnostic must not render"),
  );
  await mount();
  await click("View saved_route");
  expect(container.textContent).toContain(
    "Editing availability could not be checked. Use Refresh list to try again.",
  );
  expect(container.textContent).not.toContain(
    "Private availability diagnostic",
  );
  expect(container.textContent).not.toContain(
    "Editing is unavailable on this service",
  );
  expect(button("Save cloud changes").matches(":disabled")).toBe(true);
  expect(button("Delete cloud item").disabled).toBe(false);
  await field("Search saved data", "Help");
  await submit(".saved-data-filters");
  expect(request).toHaveBeenCalledOnce();
  let finish!: (value: { capabilities: string[] }) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click("Refresh list");
  expect(request).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain(
    "Editing is unavailable on this service",
  );
  expect(container.textContent).not.toContain(
    "Editing availability could not be checked",
  );
  expect(button("Save cloud changes").matches(":disabled")).toBe(true);
  await act(async () =>
    finish({ capabilities: ["saved-data-write", "account-binding"] }),
  );
  expect(button("Save cloud changes").matches(":disabled")).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
  expect(client.list).toHaveBeenCalledTimes(3);
  expect(client.save).not.toHaveBeenCalled();
  expect(client.remove).not.toHaveBeenCalled();
  expect(client.reconcile).not.toHaveBeenCalled();
});

it("a late account-A detail cannot render or touch the current account-B cache", async () => {
  await mount();
  let complete!: (record: SavedDataRecord) => void;
  client.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await click("View saved_route");
  const previous = rows[0];
  rows = [
    savedDataRecordFixture(
      savedDataArtifactFixture("preferences", {
        metadata: { label: "Account B appearance", folder: null, tags: [] },
      }),
    ),
  ];
  state.account = {
    configured: true,
    session: session(10),
    savedData: client,
    request,
  };
  request.mockResolvedValueOnce({
    capabilities: ["saved-data", "saved-data-export", "account-binding"],
  });
  await mount();
  const reads = client.cached.mock.calls.length;
  await act(async () => complete(previous));
  expect(container.textContent).toContain("Account B appearance");
  expect(container.querySelector(".saved-data-detail")).toBeNull();
  expect(container.textContent).not.toContain("Open Settings");
  expect(client.cached).toHaveBeenCalledTimes(reads);
  expect(client.save).not.toHaveBeenCalled();
  expect(client.reconcile).not.toHaveBeenCalled();
  await click("View Account B appearance");
  expect(button("Save cloud changes").matches(":disabled")).toBe(true);
  expect(button("Delete cloud item").disabled).toBe(false);
  expect(container.textContent).toContain(
    "Editing is unavailable on this service",
  );
  expect(container.textContent).not.toContain(
    "Editing availability could not be checked",
  );
});
