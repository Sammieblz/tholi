import { z } from "zod";

/** Shared request receipt; it never contains an object key or file contents. */
export const privateFileRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    jobId: z.string().uuid(),
    fileId: z.string().uuid(),
  })
  .strict();
