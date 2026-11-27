import { expect, it } from "vitest";
import {
  documentaryChunks,
  organizationDigest,
} from "../../../apps/api/src/application/organization";
import {
  organizationWorkflowDraftSchema,
  organizationPolicySchema,
  knowledgeDocumentSchema,
  DEFAULT_ORGANIZATION_POLICY,
  ORGANIZATION_LIMITS,
} from "../../../packages/navigation-core/contracts-organization";
import { workflowGuides } from "../../../packages/navigation-core/guides";

it("bounds documentary chunks by UTF-8 without turning source text into navigation evidence", () => {
  const text = "# Settings\n\n" + "界".repeat(3000) + "\n\nPrivacy settings";
  const chunks = documentaryChunks(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(
    chunks.every((c) => Buffer.byteLength(c) <= ORGANIZATION_LIMITS.chunkBytes),
  ).toBe(true);
  expect(chunks.join("")).toContain("界".repeat(1365));
  expect(chunks.join("")).not.toContain("\ufffd");
  expect(organizationDigest(chunks)).toMatch(/^[a-f0-9]{64}$/);
  expect(() => documentaryChunks(" ")).toThrow();
  expect(() =>
    documentaryChunks("x".repeat(ORGANIZATION_LIMITS.extractedBytes + 1)),
  ).toThrow();
});
it("requires explicit origin policy and refuses inferred provider transmission", () => {
  expect(
    organizationPolicySchema.parse(DEFAULT_ORGANIZATION_POLICY).allowedOrigins,
  ).toEqual([]);
  expect(
    organizationPolicySchema.safeParse({
      ...DEFAULT_ORGANIZATION_POLICY,
      providers: ["openai"],
    }).success,
  ).toBe(false);
  expect(
    organizationPolicySchema.safeParse({
      ...DEFAULT_ORGANIZATION_POLICY,
      allowedOrigins: ["https://example.test/private?token=value"],
    }).success,
  ).toBe(false);
});
it("keeps public documentation citations canonical and scoped to the approved origin", () => {
  const document = {
    schemaVersion: 1 as const,
    title: "Workspace guide",
    origin: "https://docs.example.test",
    format: "html" as const,
    text: "Use the workspace guide.",
  };
  expect(
    knowledgeDocumentSchema.safeParse({
      ...document,
      sourceUrl: "https://docs.example.test/guides/start",
    }).success,
  ).toBe(true);
  for (const sourceUrl of [
    "http://docs.example.test/guides/start",
    "https://other.example.test/guides/start",
    "https://docs.example.test/guides/start?session=private",
    "https://user:secret@docs.example.test/guides/start",
    "https://docs.example.test/guides/start#private",
  ])
    expect(
      knowledgeDocumentSchema.safeParse({ ...document, sourceUrl }).success,
    ).toBe(false);
});
it("rejects hidden capture payload fields and unpreviewed private step values", () => {
  const guide = workflowGuides.find(
    (g) => g.id === "github.repository.create",
  )!;
  const input = { expectedRevision: "0", origin: "https://github.com", guide };
  expect(organizationWorkflowDraftSchema.safeParse(input).success).toBe(true);
  expect(
    organizationWorkflowDraftSchema.safeParse({
      ...input,
      documentId: "native-browser-document",
    }).success,
  ).toBe(false);
  const privateGuide = structuredClone(guide);
  privateGuide.milestones[0].instruction = "Enter secret=PRIVATE_API_VALUE";
  expect(
    organizationWorkflowDraftSchema.safeParse({ ...input, guide: privateGuide })
      .success,
  ).toBe(false);
});
