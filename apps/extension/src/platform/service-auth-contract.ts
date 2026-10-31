import { z } from "zod";
import {
  identityAccountSchema,
  identitySessionSchema,
} from "../../../../packages/navigation-core/contracts-identity";
import {
  operatorEvaluationArmSchema,
  operatorEvaluationMetadataSchema,
} from "../../../../packages/navigation-core/contracts-evaluation";
import { navigationProcessingProfileSchema } from "../../../../packages/navigation-core/contracts-navigation";
export const serviceInferenceChoicesSchema = z
  .object({
    profile: z.literal("fake"),
    enabled: z.boolean(),
    images: z.boolean(),
  })
  .strict()
  .refine((value) => !value.images || value.enabled, {
    message: "Image transmission requires inference transmission.",
  });
/** Saved browser choices are not a plan, balance or provider-availability claim. */
export const serviceOperatorEvaluationSchema = operatorEvaluationMetadataSchema
  .extend({
    trialId: z.string().uuid(),
    arm: operatorEvaluationArmSchema.exclude(["local"]),
  })
  .strict();
export const serviceInferenceStatusSchema = z
  .object({
    configured: z.boolean(),
    profile: navigationProcessingProfileSchema,
    evaluation: serviceOperatorEvaluationSchema.optional(),
    enabled: z.boolean(),
    images: z.boolean(),
    serverConsentUpdated: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.profile === "operator-evaluation"
        ? value.enabled && !!value.evaluation
        : value.evaluation === undefined,
    "Temporary evaluation must remain explicit and enabled.",
  );
export type ServiceInferenceStatus = z.infer<
  typeof serviceInferenceStatusSchema
>;
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
