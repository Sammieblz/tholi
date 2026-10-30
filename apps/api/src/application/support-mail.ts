import { z } from "zod";
import { supportInputSchema } from "../../../../packages/navigation-core/contracts-support";

const identifiers = {
  templateVersion: z.literal(1),
  messageId: z.string().uuid(),
  requestId: z.string().uuid(),
};
const operatorSchema = supportInputSchema
  .omit({ idempotencyKey: true })
  .extend({ ...identifiers, template: z.literal("support.operator") })
  .strict();
const receiptSchema = z
  .object({
    ...identifiers,
    template: z.literal("support.received"),
    recipient: supportInputSchema.shape.email,
    subject: supportInputSchema.shape.subject,
  })
  .strict();
export const approvedMailSchema = z.discriminatedUnion("template", [
  operatorSchema,
  receiptSchema,
]);

/** Plain text only. User input never selects a transport, template, header or recipient. */
export function renderSupportMail(raw: unknown) {
  const command = approvedMailSchema.parse(raw);
  if (command.template === "support.operator")
    return {
      command,
      subject: `[Tholi ${command.topic}] ${command.subject}`,
      text: [
        `Request: ${command.requestId}`,
        `Name: ${command.name || "Not provided"}`,
        `Reply to: ${command.email}`,
        "",
        command.message,
      ].join("\n"),
      replyTo: command.email,
    };
  return {
    command,
    subject: "We received your Tholi message",
    text: [
      `Your Tholi message has been accepted for support processing.`,
      `Subject: ${command.subject}`,
      `Reference: ${command.requestId}`,
      "This is a receipt, not a promise of a response time. Local Tholi guidance remains available without an account.",
    ].join("\n"),
  };
}
