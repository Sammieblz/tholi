import {
  savedDataArtifactSchema,
  savedDataRecordSchema,
  type SavedDataArtifact,
  savedNavigationKnowledgeArtifactSchema,
  savedDataRecordV2Schema,
  type SavedDataArtifactV2,
  type SavedDataRecord,
  type SavedDataRecordV2,
} from "../../packages/navigation-core/contracts-saved-data";
import {
  navigationKnowledgeControlKey,
  navigationKnowledgeStateKey,
} from "../../packages/navigation-core/contracts-navigation-knowledge";

export function savedDataArtifactFixture(
  kind: SavedDataArtifact["kind"] = "saved_route",
  overrides: Partial<SavedDataArtifact> = {},
) {
  const data =
    kind === "saved_route"
      ? {
          origin: "https://example.test",
          goal: "Open Settings",
          steps: [{ kind: "control", label: "Settings" }],
          historyCompleted: false,
        }
      : kind === "site_knowledge"
        ? {
            origin: "https://example.test",
            controls: [{ role: "link", label: "Help", kind: "navigation" }],
          }
        : kind === "conversation_excerpt"
          ? { messages: [{ role: "user", text: "Find Help" }] }
          : { websiteAppearance: "dark" };
  return savedDataArtifactSchema.parse({
    id: crypto.randomUUID(),
    schemaVersion: 1,
    kind,
    data,
    metadata: { label: "Saved item", folder: null, tags: [] },
    ...overrides,
  });
}

type RecordFixtureOptions = {
  revision?: string;
  syncRevision?: string;
  deleted?: boolean;
};
export function savedDataRecordFixture(
  artifact?: SavedDataArtifact,
  options?: RecordFixtureOptions,
): SavedDataRecord;
export function savedDataRecordFixture(
  artifact: SavedDataArtifactV2,
  options?: RecordFixtureOptions,
): SavedDataRecordV2;
export function savedDataRecordFixture(
  artifact: SavedDataArtifactV2 = savedDataArtifactFixture(),
  options: RecordFixtureOptions = {},
) {
  const now = "2026-10-31T12:00:00Z";
  return (
    artifact.schemaVersion === 2
      ? savedDataRecordV2Schema
      : savedDataRecordSchema
  ).parse({
    ...artifact,
    revision: options.revision ?? "1",
    syncRevision: options.syncRevision ?? options.revision ?? "1",
    createdAt: now,
    updatedAt: now,
    data: options.deleted ? null : artifact.data,
    metadata: options.deleted
      ? { label: "Deleted item", folder: null, tags: [] }
      : artifact.metadata,
    deletedAt: options.deleted ? now : null,
  });
}

export async function savedNavigationKnowledgeFixture(
  origin = "https://example.test",
  now = new Date().toISOString(),
) {
  const descriptors = [
    { role: "button" as const, label: "Settings", kind: "control" as const },
    { role: "link" as const, label: "Help", kind: "navigation" as const },
  ];
  const controls = await Promise.all(
    descriptors.map(async (control) => ({
      key: await navigationKnowledgeControlKey(control),
      ...control,
    })),
  );
  const states = await Promise.all(
    controls.map(async (control) => ({
      key: await navigationKnowledgeStateKey([control.key]),
      controls: [control.key],
      observedAt: now,
    })),
  );
  return savedNavigationKnowledgeArtifactSchema.parse({
    id: crypto.randomUUID(),
    schemaVersion: 2,
    kind: "site_knowledge",
    metadata: { label: "Private navigation memory", folder: null, tags: [] },
    data: {
      normalizationVersion: 1,
      origin,
      controls,
      states,
      edges: [
        {
          from: states[0].key,
          to: states[1].key,
          control: controls[0].key,
          operation: "reveal",
          observedAt: now,
          successes: 1,
          failures: 0,
        },
      ],
    },
  });
}
