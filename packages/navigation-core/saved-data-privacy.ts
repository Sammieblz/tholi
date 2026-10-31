import {
  savedTaskSchema,
  type SavedTask,
  type SiteMemory,
} from "../page-model";
import { sanitizeSavedText } from "../privacy-redaction";
import {
  interfaceText,
  parameterizedTask,
  privatePlatform,
  structuralKnowledge,
} from "./privacy";
import {
  SAVED_DATA_LIMITS,
  savedDataArtifactSchema,
  savedDataMetadataSchema,
  savedRouteDataSchema,
  savedSiteKnowledgeDataSchema,
  savedConversationDataSchema,
  savedPreferencesDataSchema,
  type SavedDataArtifact,
} from "./contracts-saved-data";

export type SavedDataSource =
  | { kind: "saved_route"; value: SavedTask }
  | { kind: "site_knowledge"; value: SiteMemory }
  | {
      kind: "conversation_excerpt";
      value: readonly { role: string; text: string }[];
    }
  | { kind: "preferences"; value: { websiteAppearance: "light" | "dark" } };

/** Project every origin, including public sites. Historical IDs never cross this boundary. */
export function projectSavedRoute(source: SavedTask) {
  const original = savedTaskSchema.parse(source);
  const task = parameterizedTask({ ...original, retention: "session" });
  const privateRoute =
    original.retention === "session" ||
    privatePlatform(original.origin) ||
    original.progress.some((step) => privatePlatform(step.origin));
  let goal =
    privateRoute && task.goal !== "Saved navigation route"
      ? task.goal
      : original.goal;
  if (original.objective.value)
    goal = goal.split(original.objective.value).join("{requested item}");
  return savedRouteDataSchema.parse({
    origin: task.origin,
    goal: sanitizeSavedText(goal),
    steps: task.progress.map((step) => ({
      kind: step.kind === "navigation" ? "navigation" : "control",
      label: sanitizeSavedText(step.label, 160),
    })),
    historyCompleted: task.completed,
  });
}

export function projectSavedSiteKnowledge(source: SiteMemory) {
  const site = structuralKnowledge(
    {
      ...source,
      pages: source.pages.slice(0, 16),
      states: [],
      transitions: [],
    },
    true,
  );
  const selected = new Map<
    string,
    { role: string; label: string; kind: "control" | "navigation" }
  >();
  for (const page of site.pages) {
    if (selected.size >= 48) break;
    for (const control of page.controls) {
      if (!interfaceText(control.label)) continue;
      const entry = {
        role: sanitizeSavedText(control.role, 40),
        label: sanitizeSavedText(control.label, 160),
        kind:
          control.kind === "navigation"
            ? ("navigation" as const)
            : ("control" as const),
      };
      selected.set(JSON.stringify(entry), entry);
      if (selected.size >= 48) break;
    }
  }
  return savedSiteKnowledgeDataSchema.parse({
    origin: site.origin,
    controls: [...selected.values()].slice(0, 48),
  });
}

export function projectSavedConversation(
  source: readonly { role: string; text: string }[],
) {
  if (source.length > SAVED_DATA_LIMITS.conversationMessages)
    throw new Error("Choose a smaller conversation excerpt.");
  return savedConversationDataSchema.parse({
    messages: source
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        role: message.role,
        text: sanitizeSavedText(message.text),
      })),
  });
}

export function projectSavedPreferences(source: {
  websiteAppearance: "light" | "dark";
}) {
  return savedPreferencesDataSchema.parse({
    websiteAppearance: source.websiteAppearance,
  });
}

/** Only explicitly supplied source data is read; this helper never scans local memory. */
export function projectSavedDataArtifact(
  id: string,
  source: SavedDataSource,
  metadata: { label: string; folder?: string | null; tags?: string[] },
): SavedDataArtifact {
  const omittedValue =
    source.kind === "saved_route" ? source.value.objective.value : undefined;
  const metadataText = (value: string, maximum: number) =>
    sanitizeSavedText(
      omittedValue ? value.split(omittedValue).join("{requested item}") : value,
      maximum,
    );
  const safeMetadata = savedDataMetadataSchema.parse({
    label: metadataText(metadata.label, SAVED_DATA_LIMITS.label),
    folder:
      metadata.folder == null
        ? null
        : metadataText(metadata.folder, SAVED_DATA_LIMITS.folder),
    tags: [
      ...new Set(
        (metadata.tags ?? []).map((tag) =>
          metadataText(tag, SAVED_DATA_LIMITS.tag),
        ),
      ),
    ],
  });
  const data =
    source.kind === "saved_route"
      ? projectSavedRoute(source.value)
      : source.kind === "site_knowledge"
        ? projectSavedSiteKnowledge(source.value)
        : source.kind === "conversation_excerpt"
          ? projectSavedConversation(source.value)
          : projectSavedPreferences(source.value);
  return savedDataArtifactSchema.parse({
    id,
    schemaVersion: 1,
    kind: source.kind,
    data,
    metadata: safeMetadata,
  });
}
