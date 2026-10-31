import {
  savedDataArtifactSchema,
  savedDataRecordSchema,
  type SavedDataArtifact,
} from "../../packages/navigation-core/contracts-saved-data";

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

export function savedDataRecordFixture(
  artifact = savedDataArtifactFixture(),
  options: { revision?: string; syncRevision?: string; deleted?: boolean } = {},
) {
  const now = "2026-10-31T12:00:00Z";
  return savedDataRecordSchema.parse({
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
