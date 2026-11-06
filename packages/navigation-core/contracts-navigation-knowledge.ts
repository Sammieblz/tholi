import { z } from "zod";
import { sanitizeSavedText } from "../privacy-redaction";
import { interfaceText } from "./privacy";
import {
  serviceExpectedRevisionSchema,
  serviceRevisionSchema,
} from "./contracts-service";

/** Private historical hints never identify or authorize a current browser target. */
export const NAVIGATION_KNOWLEDGE_LIMITS = Object.freeze({
  artifactBytes: 16384,
  states: 8,
  controls: 48,
  edges: 16,
  candidates: 100,
  facts: 5,
  steps: 4,
  contextBytes: 6144,
  retentionMs: 90 * 24 * 60 * 60 * 1000,
  freshMs: 30 * 24 * 60 * 60 * 1000,
  clockSkewMs: 5 * 60 * 1000,
  forgetBatch: 20,
});
export const navigationKnowledgeOriginSchema = z
  .string()
  .url()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }, "Only an exact website origin can be saved.");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const count = z.number().int().min(0).max(1000000);
const role = z.enum([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "checkbox",
  "radio",
  "option",
  "combobox",
  "textbox",
  "searchbox",
  "switch",
  "treeitem",
  "summary",
  "region",
  "navigation",
  "heading",
  "listbox",
  "listitem",
  "section",
  "select",
  "details",
]);
const label = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => sanitizeSavedText(value, 160) === value && interfaceText(value),
    "Knowledge labels must contain approved interface text only.",
  );
export const navigationKnowledgeControlSchema = z
  .object({
    role,
    label,
    kind: z.enum(["control", "navigation"]),
  })
  .strict();
export const navigationKnowledgeOperationSchema = z.enum([
  "reveal",
  "choose",
  "navigate",
  "locate",
]);
const control = navigationKnowledgeControlSchema
  .extend({ key: digest })
  .strict();
const state = z
  .object({
    key: digest,
    controls: z.array(digest).max(NAVIGATION_KNOWLEDGE_LIMITS.controls),
    observedAt: instant,
  })
  .strict();
const edge = z
  .object({
    from: digest,
    to: digest,
    control: digest,
    operation: navigationKnowledgeOperationSchema,
    observedAt: instant,
    successes: count.min(1),
    failures: count,
  })
  .strict();

/** Keys are regenerated from approved structure, never copied or hashed from page paths. */
export const savedNavigationKnowledgeSchema = z
  .object({
    normalizationVersion: z.literal(1),
    origin: navigationKnowledgeOriginSchema,
    controls: z.array(control).max(NAVIGATION_KNOWLEDGE_LIMITS.controls),
    states: z.array(state).max(NAVIGATION_KNOWLEDGE_LIMITS.states),
    edges: z.array(edge).max(NAVIGATION_KNOWLEDGE_LIMITS.edges),
  })
  .strict()
  .superRefine((value, context) => {
    const controls = new Set(value.controls.map((item) => item.key));
    const states = new Map(value.states.map((item) => [item.key, item]));
    const edges = new Set(
      value.edges.map((item) =>
        JSON.stringify([item.from, item.to, item.control, item.operation]),
      ),
    );
    if (
      controls.size !== value.controls.length ||
      states.size !== value.states.length ||
      edges.size !== value.edges.length ||
      value.states.some(
        (item) =>
          new Set(item.controls).size !== item.controls.length ||
          item.controls.some((key) => !controls.has(key)),
      ) ||
      value.edges.some(
        (item) =>
          !states.has(item.from) ||
          !states.has(item.to) ||
          !states.get(item.from)!.controls.includes(item.control),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Knowledge references must be distinct and belong to this graph.",
      });
    }
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      NAVIGATION_KNOWLEDGE_LIMITS.artifactBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "The navigation graph is too large.",
      });
    }
  });
export type SavedNavigationKnowledge = z.infer<
  typeof savedNavigationKnowledgeSchema
>;
export type NavigationKnowledgeControl = z.infer<
  typeof navigationKnowledgeControlSchema
>;

export const navigationKnowledgeContextSchema = z
  .object({
    version: z.literal(1),
    facts: z
      .array(
        z
          .object({
            kind: z.literal("observed-route"),
            steps: z
              .array(
                navigationKnowledgeControlSchema
                  .extend({
                    operation: navigationKnowledgeOperationSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(NAVIGATION_KNOWLEDGE_LIMITS.steps),
            observedAt: instant,
            successes: count.min(1),
            failures: count,
          })
          .strict(),
      )
      .max(NAVIGATION_KNOWLEDGE_LIMITS.facts),
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      NAVIGATION_KNOWLEDGE_LIMITS.contextBytes,
    "The navigation hint context is too large.",
  );
export type NavigationKnowledgeContext = z.infer<
  typeof navigationKnowledgeContextSchema
>;

/** No URL paths, native references, selectors, user values or historical IDs are accepted. */
export const navigationKnowledgeQuerySchema = z
  .object({
    origin: navigationKnowledgeOriginSchema,
    query: z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (value) => sanitizeSavedText(value, 1000) === value,
        "The retrieval request must match its privacy preview.",
      ),
    controls: z
      .array(navigationKnowledgeControlSchema)
      .max(NAVIGATION_KNOWLEDGE_LIMITS.controls),
    maxContextBytes: z
      .number()
      .int()
      .min(0)
      .max(NAVIGATION_KNOWLEDGE_LIMITS.contextBytes)
      .default(NAVIGATION_KNOWLEDGE_LIMITS.contextBytes),
  })
  .strict();
export type NavigationKnowledgeQuery = z.infer<
  typeof navigationKnowledgeQuerySchema
>;

export const navigationKnowledgeSourceSchema = z
  .object({
    artifactId: z.string().uuid(),
    revision: serviceRevisionSchema,
  })
  .strict();
export const navigationKnowledgeSiteSettingsSchema = z
  .object({
    origin: navigationKnowledgeOriginSchema,
    revision: serviceExpectedRevisionSchema,
    collect: z.boolean(),
    use: z.boolean(),
    updatedAt: instant.nullable(),
  })
  .strict();
export const navigationKnowledgeSiteSettingsInputSchema = z
  .object({
    origin: navigationKnowledgeOriginSchema,
    expectedRevision: serviceExpectedRevisionSchema,
    idempotencyKey: z.string().uuid(),
    approved: z.literal(true),
    collect: z.boolean(),
    use: z.boolean(),
  })
  .strict();
export type NavigationKnowledgeSiteSettings = z.infer<
  typeof navigationKnowledgeSiteSettingsSchema
>;
export type NavigationKnowledgeSiteSettingsInput = z.infer<
  typeof navigationKnowledgeSiteSettingsInputSchema
>;
export const navigationKnowledgeForgetSiteInputSchema =
  navigationKnowledgeSiteSettingsInputSchema.omit({ collect: true, use: true });
export const navigationKnowledgeForgetSiteResultSchema = z
  .object({
    siteSettings: navigationKnowledgeSiteSettingsSchema,
    deletedIds: z
      .array(z.string().uuid())
      .max(NAVIGATION_KNOWLEDGE_LIMITS.forgetBatch)
      .refine((ids) => new Set(ids).size === ids.length),
    hasMore: z.boolean(),
  })
  .strict();
export type NavigationKnowledgeForgetSiteInput = z.infer<
  typeof navigationKnowledgeForgetSiteInputSchema
>;
export type NavigationKnowledgeForgetSiteResult = z.infer<
  typeof navigationKnowledgeForgetSiteResultSchema
>;
export const retrievedNavigationKnowledgeSchema = z
  .object({
    context: navigationKnowledgeContextSchema.nullable(),
    sources: z
      .array(navigationKnowledgeSourceSchema)
      .max(NAVIGATION_KNOWLEDGE_LIMITS.facts),
    siteSettings: z
      .object({
        origin: navigationKnowledgeOriginSchema,
        revision: serviceRevisionSchema,
      })
      .strict()
      .nullable(),
    contextDigest: digest.nullable(),
    snapshotDigest: digest,
    diagnostics: z
      .object({
        candidates: z
          .number()
          .int()
          .min(0)
          .max(NAVIGATION_KNOWLEDGE_LIMITS.candidates),
        selected: z
          .number()
          .int()
          .min(0)
          .max(NAVIGATION_KNOWLEDGE_LIMITS.facts),
        omitted: z
          .number()
          .int()
          .min(0)
          .max(NAVIGATION_KNOWLEDGE_LIMITS.candidates),
        reason: z.enum(["disabled", "empty", "matched", "stale", "budget"]),
      })
      .strict(),
  })
  .strict();
export type RetrievedNavigationKnowledge = z.infer<
  typeof retrievedNavigationKnowledgeSchema
>;

async function sha256(json: string) {
  const bytes = new TextEncoder().encode(json);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function navigationKnowledgeControlIdentity(
  input: NavigationKnowledgeControl,
) {
  const parsed = navigationKnowledgeControlSchema.parse({
    role: input.role,
    label: input.label,
    kind: input.kind,
  });
  return JSON.stringify([
    1,
    parsed.role,
    parsed.label.toLowerCase(),
    parsed.kind,
  ]);
}
export function navigationKnowledgeControlKey(
  input: NavigationKnowledgeControl,
) {
  return sha256(navigationKnowledgeControlIdentity(input));
}

export function navigationKnowledgeStateKey(controlKeys: readonly string[]) {
  const keys = z
    .array(digest)
    .max(NAVIGATION_KNOWLEDGE_LIMITS.controls)
    .parse(controlKeys);
  return sha256(JSON.stringify([1, [...new Set(keys)].sort()]));
}

/** Uploaded digests must be reproducible from the approved projection itself. */
export async function assertNavigationKnowledgeKeys(
  value: SavedNavigationKnowledge,
) {
  const graph = savedNavigationKnowledgeSchema.parse(value);
  for (const control of graph.controls) {
    if (control.key !== (await navigationKnowledgeControlKey(control)))
      throw new Error(
        "A knowledge control key does not match its approved structure.",
      );
  }
  for (const state of graph.states) {
    if (state.key !== (await navigationKnowledgeStateKey(state.controls)))
      throw new Error(
        "A knowledge state key does not match its approved structure.",
      );
  }
  return graph;
}

/** Renaming metadata cannot renew the age of the observed evidence. */
export function navigationKnowledgeExpiresAt(
  graph: SavedNavigationKnowledge,
  receivedAt = Date.now(),
) {
  return (
    Math.min(
      receivedAt,
      ...graph.states.map((state) => Date.parse(state.observedAt)),
      ...graph.edges.map((edge) => Date.parse(edge.observedAt)),
    ) + NAVIGATION_KNOWLEDGE_LIMITS.retentionMs
  );
}

/** Provider preflight counts these exact bytes; provenance is deliberately absent. */
export async function serializeNavigationKnowledge(
  value: NavigationKnowledgeContext,
) {
  const context = navigationKnowledgeContextSchema.parse(value);
  const json = JSON.stringify(context);
  return {
    context,
    json,
    bytes: new TextEncoder().encode(json).byteLength,
    digest: await sha256(json),
  };
}

export async function navigationKnowledgeSnapshotDigest(
  query: NavigationKnowledgeQuery,
  value: Pick<
    RetrievedNavigationKnowledge,
    "contextDigest" | "sources" | "siteSettings"
  >,
) {
  const parsed = navigationKnowledgeQuerySchema.parse(query);
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const controls = [...parsed.controls].sort((a, b) =>
    order(JSON.stringify(a), JSON.stringify(b)),
  );
  const sources = [...value.sources].sort((a, b) =>
    order(a.artifactId, b.artifactId),
  );
  return sha256(
    JSON.stringify({
      query: { ...parsed, controls },
      contextDigest: value.contextDigest,
      sources,
      siteSettings: value.siteSettings,
    }),
  );
}
