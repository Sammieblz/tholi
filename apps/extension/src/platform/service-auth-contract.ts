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
import { providerConnectionSelectionSchema } from "../../../../packages/navigation-core/contracts-providers";
export const serviceInferenceChoiceBaseSchema = z
  .object({
    profile: z.enum(["fake", "customer-funded"]),
    enabled: z.boolean(),
    images: z.boolean(),
    connection: providerConnectionSelectionSchema.optional(),
  })
  .strict();
export function refineServiceInferenceChoices(
  value: z.infer<typeof serviceInferenceChoiceBaseSchema>,
  context: z.RefinementCtx,
) {
  if (
    (value.images && !value.enabled) ||
    (value.profile === "customer-funded"
      ? !value.enabled || !value.connection
      : !!value.connection)
  )
    context.addIssue({
      code: "custom",
      message:
        "Processing requires an explicit current provider choice and transmission consent.",
    });
}
export const serviceInferenceChoicesSchema =
  serviceInferenceChoiceBaseSchema.superRefine(refineServiceInferenceChoices);
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
    connection: providerConnectionSelectionSchema.optional(),
    enabled: z.boolean(),
    images: z.boolean(),
    serverConsentUpdated: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.profile === "operator-evaluation"
        ? value.enabled && !!value.evaluation
        : value.evaluation === undefined &&
          (value.profile === "customer-funded"
            ? value.enabled && !!value.connection
            : value.connection === undefined),
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
