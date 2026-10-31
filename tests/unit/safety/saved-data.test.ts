import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import type { SiteMemory } from "../../../packages/page-model";
import {
  projectSavedConversation,
  projectSavedDataArtifact,
  projectSavedPreferences,
  projectSavedRoute,
  projectSavedSiteKnowledge,
} from "../../../packages/navigation-core/saved-data-privacy";
import {
  savedDataArtifactSchema,
  savedDataImportHash,
  savedDataImportInputSchema,
  savedDataRecordSchema,
} from "../../../packages/navigation-core/contracts-saved-data";
import { sanitizeSavedText } from "../../../packages/privacy-redaction";

describe("explicit saved-data privacy boundary", () => {
  it("keeps a usable public destination while removing local identities, form values and actionable history", () => {
    const task = saveTask(beginJourney("Open Help", "https://example.test"));
    task.objective.value = "FORM_SECRET";
    task.goal = "Search for FORM_SECRET";
    task.completed = true;
    task.progress = [
      {
        origin: task.origin,
        from: "NATIVE_DOCUMENT",
        to: "NATIVE_CONTROL",
        signature: "NATIVE_SIGNATURE",
        label: "Settings",
        kind: "action",
        at: 1,
        durationMs: 1,
      },
    ];
    const route = projectSavedRoute(task);
    expect(route.goal).toBe("Search for {requested item}");
    expect(route.historyCompleted).toBe(true);
    expect(route.steps).toEqual([{ kind: "control", label: "Settings" }]);
    expect(JSON.stringify(route)).not.toMatch(
      /FORM_SECRET|NATIVE_|objective|signature/,
    );
    const publicTask = saveTask(
      beginJourney("Find Ada Lovelace", "https://example.test"),
    );
    publicTask.objective.value = undefined;
    expect(projectSavedRoute(publicTask).goal).toBe("Find Ada Lovelace");
    expect(task.objective.value).toBe("FORM_SECRET");
    expect(
      JSON.stringify(
        projectSavedDataArtifact(
          randomUUID(),
          { kind: "saved_route", value: task },
          {
            label: "Search FORM_SECRET",
            folder: "FORM_SECRET",
            tags: ["FORM_SECRET"],
          },
        ),
      ),
    ).not.toContain("FORM_SECRET");
  });

  it("projects only static interface controls on every origin and drops page paths, options and descriptions", () => {
    const site: SiteMemory = {
      schemaVersion: 1,
      origin: "https://example.test",
      version: 1,
      lastSeen: 1,
      templates: [],
      transitions: [],
      pages: [
        {
          key: "NATIVE_PAGE",
          path: "/FORM_SECRET",
          templateKey: "NATIVE_TEMPLATE",
          fingerprint: "NATIVE_FINGERPRINT",
          version: 1,
          lastSeen: 1,
          stateKey: "NATIVE_STATE",
          controls: [
            {
              signature: "NATIVE_SIGNATURE",
              role: "button",
              kind: "action",
              risk: "ordinary",
              label: "Settings",
              description: "FORM_SECRET",
              context: "FORM_SECRET",
              group: "FORM_SECRET",
              visible: true,
              enabled: true,
              lastSeen: 1,
              active: true,
              options: [
                { label: "FORM_SECRET", enabled: true, selected: true },
              ],
            },
            {
              signature: "SECRET_SIGNATURE",
              role: "button",
              kind: "action",
              risk: "ordinary",
              label: "FORM_SECRET",
              context: "",
              group: "",
              visible: true,
              enabled: true,
              lastSeen: 1,
              active: true,
            },
          ],
        },
      ],
    };
    const projected = projectSavedSiteKnowledge(site);
    expect(projected.controls).toEqual([
      { role: "button", kind: "control", label: "Settings" },
    ]);
    expect(JSON.stringify(projected)).not.toMatch(
      /FORM_SECRET|NATIVE_|description|options|path/,
    );
    expect(site.pages[0].path).toBe("/FORM_SECRET");
  });

  it("saves only deliberately supplied user/assistant excerpts and known cosmetic preferences", () => {
    const excerpt = projectSavedConversation([
      { role: "system", text: "INTERNAL_SECRET" },
      { role: "user", text: "password: hunter2" },
      { role: "assistant", text: "Open Settings" },
    ]);
    expect(excerpt.messages).toEqual([
      { role: "user", text: "[redacted]" },
      { role: "assistant", text: "Open Settings" },
    ]);
    const preferences = {
      websiteAppearance: "dark" as const,
      consent: true,
      token: "INTERNAL_SECRET",
    };
    expect(projectSavedPreferences(preferences)).toEqual({
      websiteAppearance: "dark",
    });
    expect(() =>
      projectSavedConversation(
        Array.from({ length: 13 }, () => ({ role: "user", text: "Help" })),
      ),
    ).toThrow();
    expect(() => sanitizeSavedText("x".repeat(1001))).toThrow();
    const longRequest = "Keep " + "help ".repeat(40);
    expect(sanitizeSavedText(longRequest)).toBe(longRequest.trim());
  });

  it("rejects noncanonical uploads and tombstones that retain deleted metadata", () => {
    const artifact = projectSavedDataArtifact(
      randomUUID(),
      { kind: "preferences", value: { websiteAppearance: "dark" } },
      { label: "Appearance" },
    );
    expect(
      savedDataArtifactSchema.safeParse({
        ...artifact,
        screenshot: "PRIVATE_PIXELS",
      }).success,
    ).toBe(false);
    expect(
      savedDataArtifactSchema.safeParse({
        ...artifact,
        data: { websiteAppearance: "dark", password: "hunter2" },
      }).success,
    ).toBe(false);
    expect(
      savedDataArtifactSchema.safeParse({
        ...artifact,
        metadata: { ...artifact.metadata, label: "password: hunter2" },
      }).success,
    ).toBe(false);
    const record = {
      ...artifact,
      data: null,
      revision: "2",
      syncRevision: "2",
      createdAt: "2026-10-31T00:00:00Z",
      updatedAt: "2026-10-31T00:01:00Z",
      deletedAt: "2026-10-31T00:01:00Z",
    };
    expect(savedDataRecordSchema.safeParse(record).success).toBe(false);
    expect(
      savedDataRecordSchema.safeParse({
        ...record,
        metadata: { label: "Deleted item", folder: null, tags: [] },
      }).success,
    ).toBe(true);
  });

  it("binds import approval to exact canonical content, revisions, account and workspace", async () => {
    const artifact = projectSavedDataArtifact(
      randomUUID(),
      { kind: "preferences", value: { websiteAppearance: "dark" } },
      { label: "Appearance" },
    );
    const scope = { accountId: randomUUID(), workspaceId: randomUUID() };
    const items = [{ expectedRevision: "0", artifact }];
    const hash = await savedDataImportHash(scope, items);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await savedDataImportHash(scope, [{ artifact, expectedRevision: "0" }]),
    ).toBe(hash);
    expect(
      await savedDataImportHash({ ...scope, accountId: randomUUID() }, items),
    ).not.toBe(hash);
    expect(
      await savedDataImportHash({ ...scope, workspaceId: randomUUID() }, items),
    ).not.toBe(hash);
    expect(
      await savedDataImportHash(scope, [
        { ...items[0], expectedRevision: "1" },
      ]),
    ).not.toBe(hash);
    expect(
      await savedDataImportHash(scope, [
        {
          ...items[0],
          artifact: {
            ...artifact,
            metadata: { ...artifact.metadata, label: "Changed" },
          },
        },
      ]),
    ).not.toBe(hash);
    expect(
      savedDataImportInputSchema.safeParse({
        idempotencyKey: randomUUID(),
        approved: true,
        previewHash: hash,
        items: [items[0], items[0]],
      }).success,
    ).toBe(false);
  });
});
