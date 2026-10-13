import { z } from "zod";
export const navigationActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("control"),
      controlId: z.string(),
      signature: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("close-surface"),
      controlId: z.string(),
      signature: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("history-back"),
      entryId: z.string(),
      tabId: z.number().int(),
      expectedState: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tab-switch"),
      entryId: z.string(),
      tabId: z.number().int(),
      expectedState: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("visual"),
      captureId: z.string(),
      viewportRevision: z.number().int(),
      text: z.string().max(160),
      box: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict(),
      risk: z.literal("unknown"),
    })
    .strict(),
]);
export type NavigationAction = z.infer<typeof navigationActionSchema>;

export const ledgerEntrySchema = z
  .object({
    id: z.string(),
    tabId: z.number().int(),
    documentId: z.string(),
    origin: z.string(),
    state: z.string(),
    at: z.number(),
    navigation: z.boolean().optional(),
    path: z.string().optional(),
    previous: z.string().optional(),
    labels: z.array(z.string().max(160)).max(100),
    surfaces: z.array(z.string().max(100)).max(100),
  })
  .strict();
