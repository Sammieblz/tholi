import { it, expect, vi, afterEach } from "vitest";
import {
  LocalModel,
  modelAvailability,
} from "../apps/extension/src/local-model";
import type { PageSnapshot } from "../packages/page-model";
const page: PageSnapshot = {
  origin: "https://example.org",
  path: "/",
  pageKey: "page",
  stateKey: "state",
  templateKey: "template",
  fingerprint: "structure",
  revision: 1,
  layout: "wide",
  language: "en",
  partial: false,
  controls: [
    {
      id: "w0000000000000000-1",
      signature: "control",
      role: "button",
      label: "Help",
      description: "Find the documentation",
      popup: "dialog",
      context: "Navigation",
      scope: "page",
      group: "Navigation",
      kind: "action",
      visible: true,
      enabled: true,
      inViewport: true,
      revealIds: [],
      risk: "ordinary",
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("reports unavailable API and never creates a remote inference dependency", async () => {
  vi.stubGlobal("LanguageModel", undefined);
  expect(await modelAvailability()).toBe("unavailable");
  expect(() => new LocalModel().enable(() => {})).toThrow("unavailable");
});
it("uses structured local output constrained to discovered IDs and treats labels as untrusted", async () => {
  const prompt = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ controlIds: [page.controls[0].id], confidence: 0.9 }),
      ),
    destroy = vi.fn();
  const create = vi.fn().mockResolvedValue({ prompt, destroy });
  vi.stubGlobal("LanguageModel", {
    availability: async () => "available",
    create,
  });
  const model = new LocalModel();
  await model.enable(() => {});
  expect(create.mock.calls[0][0].initialPrompts[0].content).toContain(
    "untrusted data",
  );
  const proposed = await model.propose(
    page,
    "Help",
    new AbortController().signal,
  );
  expect(proposed.controlIds).toEqual([page.controls[0].id]);
  expect(JSON.parse(prompt.mock.calls[0][0]).controls[0]).toMatchObject({
    description: "Find the documentation",
    popup: "dialog",
    scope: "page",
  });
  expect(
    prompt.mock.calls[0][1].responseConstraint.properties.controlIds.items.enum,
  ).toEqual([page.controls[0].id]);
  expect(JSON.parse(prompt.mock.calls[0][0]).controls[0]).not.toHaveProperty(
    "destination",
  );
  prompt.mockResolvedValue('{"selector":"#malicious"}');
  await expect(
    model.propose(page, "Help", new AbortController().signal),
  ).rejects.toThrow();
  await model.close();
  expect(destroy).toHaveBeenCalledOnce();
});
