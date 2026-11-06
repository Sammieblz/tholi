import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import type { PageSnapshot, SiteMemory } from "../../../packages/page-model";
import { mergeObservation } from "../../../packages/site-memory";
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
import {
  projectNavigationKnowledge,
  navigationKnowledgeQueryFromObservation,
} from "../../../packages/navigation-core/navigation-knowledge-projection";
import { navigationModelObservation } from "../../support/navigation-model-fixture";
import {
  navigationKnowledgeControlKey,
  navigationKnowledgeStateKey,
} from "../../../packages/navigation-core/contracts-navigation-knowledge";

describe("explicit saved-data privacy boundary", () => {
  it("retrieval queries keep only sanitized public structure and never reuse native identity or private URL paths", () => {
    const observation = navigationModelObservation();
    observation.omissions.controls = 0;
    observation.context.goal = "Find alice@example.test settings";
    const query = navigationKnowledgeQueryFromObservation(
      observation,
      "https://example.test",
    );
    expect(query.controls).toEqual([
      { role: "button", label: "Settings", kind: "control" },
    ]);
    expect(query.query).not.toContain("alice@example.test");
    expect(JSON.stringify(query)).not.toMatch(
      /native:root-document|controlId|documentId|windowId|tabId|frameId|stamp|signature|viewport/,
    );
    for (const origin of [
      "https://example.test/private-path",
      "https://example.test?private=value",
      "https://example.test#private",
      "file:///private",
    ])
      expect(() =>
        navigationKnowledgeQueryFromObservation(observation, origin),
      ).toThrow();
    expect(observation.native.documentId).toBe("native:root-document");
  });
  it("learns only verified ordinary transitions and regenerates cloud keys without private paths or native identities", async () => {
    const now = Date.now();
    const page = (
      key: string,
      label: string,
      kind: "expand" | "navigation",
    ) => ({
      key,
      stateKey: key,
      path: "/PRIVATE_PATH",
      templateKey: "NATIVE_TEMPLATE",
      fingerprint: "NATIVE_FINGERPRINT",
      version: 1,
      lastSeen: now,
      complete: true,
      controls: [
        {
          signature: `NATIVE_${key}`,
          role: kind === "navigation" ? "link" : "button",
          label,
          kind,
          risk: "ordinary" as const,
          visible: true,
          enabled: true,
          active: true,
          lastSeen: now,
          context: "PRIVATE_INPUT",
          group: "PRIVATE_GROUP",
          description: "PRIVATE_DESCRIPTION",
          options: [{ label: "PRIVATE_VALUE", selected: true, enabled: true }],
        },
      ],
    });
    const a = page("NATIVE_FROM", "Settings", "expand"),
      b = page("NATIVE_TO", "Help", "navigation");
    const source: SiteMemory = {
      schemaVersion: 1,
      origin: "https://example.test",
      version: 1,
      lastSeen: now,
      templates: [],
      pages: [a, b],
      states: [a, b],
      transitions: [
        {
          from: a.stateKey,
          to: b.stateKey,
          signature: a.controls[0].signature,
          label: "Settings",
          evidence: "observed",
          active: true,
          lastVerified: now,
          requiresFreshBinding: true,
          action: { kind: "control", signature: a.controls[0].signature },
        },
        {
          from: b.stateKey,
          to: a.stateKey,
          signature: b.controls[0].signature,
          label: "Help",
          evidence: "inferred",
          active: true,
          lastVerified: now,
        },
      ],
    };
    const graph = await projectNavigationKnowledge(source, now);
    expect(graph.edges).toHaveLength(1);
    expect(graph.controls.map((control) => control.label).sort()).toEqual([
      "Help",
      "Settings",
    ]);
    expect(JSON.stringify(graph)).not.toMatch(
      /PRIVATE_|NATIVE_|signature|path|description|options|reference/,
    );
    expect(source.pages[0].path).toBe("/PRIVATE_PATH");
    expect(
      (await projectNavigationKnowledge(source, now, now + 1)).edges,
    ).toHaveLength(0);
    expect(
      (
        await projectNavigationKnowledge(
          {
            ...source,
            pages: source.pages.map((page) => ({ ...page, complete: false })),
            states: [],
          },
          now,
        )
      ).edges,
    ).toHaveLength(0);
  });
  it("keeps complete hidden-menu states distinct and learns their edge only from independently supplied transition evidence", async () => {
    const now = Date.now();
    const before: PageSnapshot = {
      origin: "https://example.test",
      path: "/",
      pageKey: "local-page",
      stateKey: "local-page:closed",
      templateKey: "local-template",
      fingerprint: "closed-menu",
      revision: 1,
      language: "en",
      layout: "wide",
      partial: false,
      controls: [
        {
          id: "w0000000000000001-1",
          signature: "local-settings",
          role: "button",
          label: "Settings",
          context: "",
          group: "",
          kind: "expand",
          risk: "ordinary",
          visible: true,
          enabled: true,
          inViewport: true,
          revealIds: ["w0000000000000001-2"],
          expanded: false,
        },
        {
          id: "w0000000000000001-2",
          signature: "local-help",
          role: "link",
          label: "Help",
          context: "",
          group: "",
          kind: "navigation",
          risk: "ordinary",
          visible: false,
          enabled: true,
          inViewport: false,
          revealIds: [],
        },
      ],
    };
    const after: PageSnapshot = {
      ...before,
      stateKey: "local-page:open",
      fingerprint: "open-menu",
      revision: 2,
      controls: before.controls.map((control, index) => ({
        ...control,
        visible: true,
        inViewport: true,
        ...(index === 0 ? { expanded: true } : {}),
      })),
    };
    const initial = mergeObservation(undefined, before, undefined, now - 1),
      observedOnly = mergeObservation(initial, after, undefined, now),
      verified = mergeObservation(
        initial,
        after,
        {
          from: before.stateKey,
          to: after.stateKey,
          signature: before.controls[0].signature,
          label: "Settings",
        },
        now,
      );
    expect((await projectNavigationKnowledge(observedOnly, now)).edges).toEqual(
      [],
    );
    const graph = await projectNavigationKnowledge(verified, now);
    expect(graph.states).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].operation).toBe("reveal");
    const queryFor = (page: PageSnapshot) => {
      const observation = navigationModelObservation();
      observation.context.goal = "Find Help";
      observation.omissions = {
        frames: 0,
        regions: 0,
        controls: 0,
        reasons: [],
      };
      observation.controls = page.controls.map((control) => ({
        reference: { ...observation.native, controlId: control.id },
        role: control.role as "button" | "link",
        label: control.label,
        kind: control.kind,
        risk: control.risk,
        eligible: control.visible && control.enabled && !control.occluded,
        visible: control.visible,
        enabled: control.enabled,
        occluded: control.occluded ?? false,
        inViewport: control.inViewport,
        revealIds: control.revealIds,
      }));
      return navigationKnowledgeQueryFromObservation(observation, page.origin);
    };
    const stateFor = async (page: PageSnapshot) =>
      navigationKnowledgeStateKey(
        await Promise.all(
          queryFor(page).controls.map(navigationKnowledgeControlKey),
        ),
      );
    expect(queryFor(before).controls.map((control) => control.label)).toEqual([
      "Settings",
    ]);
    expect(queryFor(after).controls.map((control) => control.label)).toEqual([
      "Settings",
      "Help",
    ]);
    expect(graph.edges[0]).toMatchObject({
      from: await stateFor(before),
      to: await stateFor(after),
    });
    const ambiguous = {
      ...after,
      controls: [
        ...after.controls,
        {
          ...after.controls[1],
          id: "w0000000000000001-3",
          signature: "other-local-help",
          label: "help",
        },
      ],
    };
    expect(
      queryFor(ambiguous).controls.map((control) => control.label),
    ).toEqual(["Settings"]);
    const ambiguousGraph = await projectNavigationKnowledge(
      mergeObservation(
        initial,
        ambiguous,
        {
          from: before.stateKey,
          to: after.stateKey,
          signature: before.controls[0].signature,
          label: "Settings",
        },
        now,
      ),
      now,
    );
    expect(ambiguousGraph.controls.map((control) => control.label)).toEqual([
      "Settings",
    ]);
    expect(ambiguousGraph.edges).toEqual([]);
    for (const unavailable of [{ enabled: false }, { occluded: true }]) {
      const changed = {
        ...before,
        controls: before.controls.map((control) => ({
          ...control,
          ...unavailable,
        })),
      };
      expect(queryFor(changed).controls).toEqual([]);
      const unavailableMemory = mergeObservation(
        undefined,
        changed,
        undefined,
        now,
      );
      expect(
        (await projectNavigationKnowledge(unavailableMemory, now)).states,
      ).toEqual([]);
    }
    const offscreen = {
      ...before,
      controls: before.controls.map((control) => ({
        ...control,
        inViewport: false,
      })),
    };
    expect(await stateFor(offscreen)).toBe(await stateFor(before));
    const partial = mergeObservation(
      initial,
      { ...after, partial: true },
      {
        from: before.stateKey,
        to: after.stateKey,
        signature: before.controls[0].signature,
        label: "Settings",
      },
      now,
    );
    expect((await projectNavigationKnowledge(partial, now)).edges).toEqual([]);
  });
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
