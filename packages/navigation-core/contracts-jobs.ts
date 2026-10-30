import { z } from "zod";
import { authorizationPageQuerySchema } from "./contracts-authorization";
import { servicePageSchema, serviceRevisionSchema } from "./contracts-service";

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
  "uncertain",
]);
export const jobErrorCodeSchema = z.enum([
  "HANDLER_FAILED",
  "LEASE_EXPIRED",
  "CANCELLED",
  "AUTHORIZATION_REVOKED",
  "UNSUPPORTED_JOB",
  "RETRY_EXHAUSTED",
  "SHUTDOWN",
  "UNAVAILABLE",
]);
/** Current handlers process one bounded batch and never return private records. */
export const jobResultSchema = z
  .object({ processed: z.number().int().min(0).max(100) })
  .strict();
export const jobSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.string().min(1).max(100),
    version: z.number().int().min(1).max(2147483647),
    status: jobStatusSchema,
    attempts: z.number().int().min(0).max(100),
    maxAttempts: z.number().int().min(1).max(100),
    revision: serviceRevisionSchema,
    cancelRequested: z
      .boolean()
      .describe(
        "An intent to stop. Running or uncertain work may already have external effects.",
      ),
    errorCode: jobErrorCodeSchema.nullable(),
    result: jobResultSchema.nullable(),
    availableAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((job) => job.attempts <= job.maxAttempts);
export const jobPageQuerySchema = authorizationPageQuerySchema
  .extend({ status: jobStatusSchema.optional() })
  .strict();
export const jobPageSchema = servicePageSchema(jobSchema).extend({
  nextCursor: z.string().uuid().optional(),
});
export const cancelJobInputSchema = z
  .object({ expectedRevision: serviceRevisionSchema })
  .strict();

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobPageQuery = z.infer<typeof jobPageQuerySchema>;
