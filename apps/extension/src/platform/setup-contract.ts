import { z } from "zod";

export const setupStateSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    step: z.number().int().min(1).max(3),
    choice: z.enum(["local", "account"]).optional(),
  })
  .strict();
export const setupCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETUP_STATUS") }).strict(),
  z.object({ type: z.literal("SETUP_OPEN") }).strict(),
  z
    .object({
      type: z.literal("SETUP_STEP"),
      step: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("SETUP_COMPLETE"),
      choice: z.enum(["local", "account"]),
    })
    .strict(),
]);
export type SetupState = z.infer<typeof setupStateSchema>;
