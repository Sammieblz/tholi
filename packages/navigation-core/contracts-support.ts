import { z } from "zod";
import { jobStatusSchema, type JobStatus } from "./contracts-jobs";
import {
  serviceIdempotencyKeySchema,
  serviceRevisionSchema,
} from "./contracts-service";

export const SUPPORT_LIMITS = Object.freeze({
  name: 80,
  email: 254,
  subject: 120,
  message: 3000,
  maxFileBytes: 131072,
  supportRetentionMs: 2592000000,
  fileRetentionMs: 3600000,
  maxLinkLifetimeMs: 60000,
  hourlyRequests: 3,
  dailyRequests: 10,
});
export const SUPPORT_TOPICS = [
  "Support",
  "Feedback",
  "Partnerships",
  "Something else",
] as const;
export const supportTopicSchema = z.enum(SUPPORT_TOPICS);
const singleLine = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const supportInputSchema = z
  .object({
    idempotencyKey: serviceIdempotencyKeySchema,
    name: singleLine(SUPPORT_LIMITS.name).optional(),
    email: z.string().trim().max(SUPPORT_LIMITS.email).email(),
    topic: supportTopicSchema,
    subject: singleLine(SUPPORT_LIMITS.subject).refine(
      (value) => value.length > 0,
    ),
    message: z
      .string()
      .trim()
      .min(1)
      .max(SUPPORT_LIMITS.message)
      .refine((value) => !value.includes("\0")),
  })
  .strict();
export const supportRequestSchema = z
  .object({
    id: z.string().uuid(),
    operatorJobId: z.string().uuid(),
    receiptJobId: z.string().uuid().nullable(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const diagnosticInputSchema = z
  .object({
    idempotencyKey: serviceIdempotencyKeySchema,
  })
  .strict();
export const diagnosticSchema = z
  .object({
    requestId: z.string().uuid(),
    jobId: z.string().uuid(),
    fileId: z.string().uuid(),
  })
  .strict();
export const privateFileSchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    revision: serviceRevisionSchema,
    expiresAt: z.string().datetime({ offset: true }),
    status: z.enum(["pending", "ready", "deleting", "deleted"]),
  })
  .strict();
export const fileLinkInputSchema = z
  .object({
    expectedRevision: serviceRevisionSchema,
  })
  .strict();
export const fileLinkSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const fileDownloadQuerySchema = z
  .object({
    token: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9._-]+$/),
  })
  .strict();

const jobCounts = Object.fromEntries(
  jobStatusSchema.options.map((status) => [
    status,
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ]),
) as Record<JobStatus, z.ZodNumber>;
/** An explicit diagnostic contains service metadata and counts, never browsing content. */
export const diagnosticSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/),
    profile: z.literal("service"),
    accountStatus: z.literal("active"),
    workspaceKind: z.literal("personal"),
    role: z.literal("owner"),
    jobs: z.object(jobCounts).strict(),
  })
  .strict();

export type SupportInput = z.infer<typeof supportInputSchema>;
export type SupportTopic = z.infer<typeof supportTopicSchema>;
export type SupportRequest = z.infer<typeof supportRequestSchema>;
export type DiagnosticSnapshot = z.infer<typeof diagnosticSnapshotSchema>;
export type PrivateFile = z.infer<typeof privateFileSchema>;
