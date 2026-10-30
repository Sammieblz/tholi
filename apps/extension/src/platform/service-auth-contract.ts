import { z } from "zod";
import {
  identityAccountSchema,
  identitySessionSchema,
} from "../../../../packages/navigation-core/contracts-identity";
/** The panel receives account metadata only. Credentials remain in the background. */
export const serviceAuthStatusSchema = z
  .object({
    configured: z.boolean(),
    origin: z.string().optional(),
    account: identityAccountSchema.optional(),
    session: identitySessionSchema.optional(),
  })
  .strict();
export type ServiceAuthStatus = z.infer<typeof serviceAuthStatusSchema>;
