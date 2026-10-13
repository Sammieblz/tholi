import { z } from "zod";
import { pageSnapshotSchema, controlSchema } from "../page-model";
import { planInputSchema, resultSchema } from "./contracts";
import { controlReferenceSchema, coverageSchema } from "./workflow-contracts";
export const planInputV2Schema = planInputSchema.and(
  z
    .object({
      protocolVersion: z.literal(2),
      contextRevision: z.number().int().nonnegative(),
    })
    .passthrough(),
);
export const resultV2Schema = resultSchema.extend({
  protocolVersion: z.literal(2),
  contextRevision: z.number().int().nonnegative(),
});
export const observationDeltaSchema = z
  .object({
    protocolVersion: z.literal(2),
    documentId: z.string().max(200),
    frameId: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    baseRevision: z.number().int().nonnegative(),
    observation: pageSnapshotSchema.optional(),
    upserts: z.array(controlSchema).max(600),
    removed: z.array(z.string().max(100)).max(600),
    coverage: z.array(coverageSchema).max(100),
  })
  .strict()
  .refine((d) => !d.observation || d.observation.revision === d.revision, {
    message: "Delta revision must match its observation.",
  });
export const observationEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(2),
    reference: controlReferenceSchema.omit({ controlId: true }),
    observation: pageSnapshotSchema,
  })
  .strict();
