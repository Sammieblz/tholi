import { createHash } from "node:crypto";
import { z } from "zod";
import { bm25 } from "../../../../packages/nlp/retrieval";
import {
  ORGANIZATION_LIMITS,
  organizationWorkflowDraftSchema,
  organizationWorkflowActionSchema,
  organizationWorkflowSchema,
  organizationWorkflowPageSchema,
  organizationPolicyInputSchema,
  organizationPolicyRecordSchema,
  knowledgeDocumentSchema,
  knowledgeSourcePageSchema,
  knowledgeSourceSchema,
  knowledgeQuerySchema,
  documentaryRetrievalSchema,
  knowledgeFileImportSchema,
  knowledgeSourceExportSchema,
  publicDocumentationCrawlSchema,
  publicDocumentationCrawlResultSchema,
  type OrganizationWorkflow,
  type OrganizationWorkflowDraft,
  type OrganizationWorkflowAction,
  type DocumentaryBundle,
} from "../../../../packages/navigation-core/contracts-organization";
import type { ServiceRequestContext } from "../capabilities";
import type { IdentitySession } from "./identity-contracts";
import type { AuthorizationContextReader } from "./authorization-policy";
import {
  AuthorizationError,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";

export interface OrganizationTransaction extends AuthorizationContextReader {
  withOrganization<T>(
    work: (store: OrganizationStore) => Promise<T>,
  ): Promise<T>;
}
export interface OrganizationStore {
  policy(): Promise<z.infer<typeof organizationPolicyRecordSchema>>;
  setPolicy(
    input: z.infer<typeof organizationPolicyInputSchema>,
  ): Promise<z.infer<typeof organizationPolicyRecordSchema>>;
  workflows(publishedOnly: boolean): Promise<OrganizationWorkflow[]>;
  saveWorkflow(
    id: string,
    input: OrganizationWorkflowDraft,
  ): Promise<OrganizationWorkflow>;
  actWorkflow(
    id: string,
    input: OrganizationWorkflowAction,
  ): Promise<OrganizationWorkflow>;
  sources(): Promise<z.infer<typeof knowledgeSourceSchema>[]>;
  source(id: string): Promise<z.infer<typeof knowledgeSourceExportSchema>>;
  saveSource(
    input: z.infer<typeof knowledgeDocumentSchema>,
    chunks: string[],
  ): Promise<z.infer<typeof knowledgeSourceSchema>>;
  deleteSource(id: string, revision: string): Promise<void>;
  chunks(origin: string): Promise<DocumentaryBundle[]>;
}
export interface DocumentConverter {
  extract(
    input: Pick<z.infer<typeof knowledgeFileImportSchema>, "format" | "base64">,
    context: ServiceRequestContext,
  ): Promise<string>;
}
export interface PublicDocumentationCrawler {
  crawl(
    input: z.infer<typeof publicDocumentationCrawlSchema>,
    signal: AbortSignal,
  ): Promise<{
    documents: { url: string; title: string; html: string }[];
    visited: number;
    skipped: number;
  }>;
}
type Principal = Pick<IdentitySession, "accountId">;
export function organizationDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** One bounded document splitter. It preserves order, citations and UTF-8 limits. */
export function documentaryChunks(text: string): string[] {
  if (Buffer.byteLength(text, "utf8") > ORGANIZATION_LIMITS.extractedBytes)
    throw new AuthorizationError(
      413,
      "INVALID_REQUEST",
      "The extracted document is too large.",
    );
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Paragraph/heading boundaries take precedence; very long paragraphs are split
  // by Unicode code point without breaking UTF-8 or allocating pairwise matrices.
  for (const paragraph of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const clean = paragraph
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim();
    if (!clean) continue;
    const cleanBytes = Buffer.byteLength(clean, "utf8");
    if (
      current &&
      currentBytes + 2 + cleanBytes <= ORGANIZATION_LIMITS.chunkBytes
    ) {
      current += "\n\n" + clean;
      currentBytes += 2 + cleanBytes;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    for (const point of clean) {
      const bytes = Buffer.byteLength(point, "utf8");
      if (currentBytes + bytes > ORGANIZATION_LIMITS.chunkBytes) {
        chunks.push(current);
        current = "";
        currentBytes = 0;
      }
      current += point;
      currentBytes += bytes;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length || chunks.length > ORGANIZATION_LIMITS.chunks)
    throw new AuthorizationError(
      413,
      "INVALID_REQUEST",
      "The document exceeds extraction limits.",
    );
  return chunks;
}

/** Organization content never enters actor-private saved-data DTOs or browser commands. */
export class OrganizationService {
  constructor(
    private repositories: AuthorizedRepositories<OrganizationTransaction>,
    private environment: "development" | "production" = "production",
    private converter?: DocumentConverter,
    private crawler?: PublicDocumentationCrawler,
  ) {}
  get importsAvailable() {
    return this.available && !!this.converter;
  }
  get available() {
    return this.environment === "development";
  }
  get publicCrawlingAvailable() {
    return this.available && !!this.converter && !!this.crawler;
  }
  private run<T>(
    principal: Principal,
    workspaceId: string,
    action:
      | "organization.read"
      | "organization.write"
      | "organization.publish"
      | "organization.policy",
    context: ServiceRequestContext,
    work: (store: OrganizationStore) => Promise<T>,
  ) {
    if (!this.available)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Organization pilot services are unavailable in this deployment.",
      );
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      action,
      (repository) => repository.withOrganization(work),
      context,
    );
  }
  policy(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.run(
      principal,
      workspaceId,
      "organization.read",
      context,
      async (s) => organizationPolicyRecordSchema.parse(await s.policy()),
    );
  }
  setPolicy(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = organizationPolicyInputSchema.parse(raw);
    return this.run(
      principal,
      workspaceId,
      "organization.policy",
      context,
      (s) => s.setPolicy(input),
    );
  }
  workflows(
    principal: Principal,
    workspaceId: string,
    publishedOnly: boolean,
    context: ServiceRequestContext,
  ) {
    return this.run(
      principal,
      workspaceId,
      "organization.read",
      context,
      async (s) =>
        organizationWorkflowPageSchema.parse({
          items: await s.workflows(publishedOnly),
        }),
    );
  }
  saveWorkflow(
    principal: Principal,
    workspaceId: string,
    id: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    z.string().uuid().parse(id);
    const input = organizationWorkflowDraftSchema.parse(raw);
    return this.run(
      principal,
      workspaceId,
      "organization.write",
      context,
      async (s) =>
        organizationWorkflowSchema.parse(await s.saveWorkflow(id, input)),
    );
  }
  actWorkflow(
    principal: Principal,
    workspaceId: string,
    id: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    z.string().uuid().parse(id);
    const input = organizationWorkflowActionSchema.parse(raw);
    return this.run(
      principal,
      workspaceId,
      input.action === "submit" ? "organization.write" : "organization.publish",
      context,
      async (s) =>
        organizationWorkflowSchema.parse(await s.actWorkflow(id, input)),
    );
  }
  sources(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.run(
      principal,
      workspaceId,
      "organization.read",
      context,
      async (s) =>
        knowledgeSourcePageSchema.parse({ items: await s.sources() }),
    );
  }
  source(
    principal: Principal,
    workspaceId: string,
    id: string,
    context: ServiceRequestContext,
  ) {
    z.string().uuid().parse(id);
    return this.run(
      principal,
      workspaceId,
      "organization.read",
      context,
      async (s) => knowledgeSourceExportSchema.parse(await s.source(id)),
    );
  }
  saveSource(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = knowledgeDocumentSchema.parse(raw),
      chunks = documentaryChunks(input.text);
    return this.run(
      principal,
      workspaceId,
      "organization.publish",
      context,
      async (s) => {
        if (!(await s.policy()).policy.allowedOrigins.includes(input.origin))
          throw new AuthorizationError(
            403,
            "FORBIDDEN",
            "Approve the application origin before importing its documentation.",
          );
        return knowledgeSourceSchema.parse(await s.saveSource(input, chunks));
      },
    );
  }
  async importFile(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    if (!this.converter)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Document conversion is not configured.",
      );
    const input = knowledgeFileImportSchema.parse(raw),
      bytes = Buffer.from(input.base64, "base64");
    if (
      bytes.byteLength > ORGANIZATION_LIMITS.documentBytes ||
      bytes.toString("base64") !== input.base64
    )
      throw new AuthorizationError(
        413,
        "INVALID_REQUEST",
        "The document exceeds its import limit.",
      );
    await this.run(
      principal,
      workspaceId,
      "organization.publish",
      context,
      async (s) => {
        if (!(await s.policy()).policy.allowedOrigins.includes(input.origin))
          throw new AuthorizationError(
            403,
            "FORBIDDEN",
            "Approve the application origin before importing its documentation.",
          );
      },
    );
    // No SQL transaction is retained during conversion. Admission and policy are
    // checked again before the extracted content can become shared knowledge.
    const text = await this.converter.extract(
      { format: input.format, base64: input.base64 },
      context,
    );
    return this.saveSource(
      principal,
      workspaceId,
      {
        schemaVersion: 1,
        title: input.title,
        origin: input.origin,
        format: input.format,
        text,
      },
      context,
    );
  }
  async crawlPublicDocumentation(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = publicDocumentationCrawlSchema.parse(raw);
    if (!this.publicCrawlingAvailable || !this.converter || !this.crawler)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Public documentation import is not enabled in this deployment.",
      );
    await this.run(
      principal,
      workspaceId,
      "organization.publish",
      context,
      async (store) => {
        if (!(await store.policy()).policy.allowedOrigins.includes(input.origin))
          throw new AuthorizationError(
            403,
            "FORBIDDEN",
            "Approve this application origin before importing its public documentation.",
          );
      },
    );
    let crawled: Awaited<ReturnType<PublicDocumentationCrawler["crawl"]>>;
    try {
      crawled = await this.crawler.crawl(input, context.signal);
    } catch {
      context.signal.throwIfAborted();
      throw new AuthorizationError(
        422,
        "INVALID_REQUEST",
        "The documentation site could not be imported safely. Check its robots rules and choose a public HTTPS documentation page.",
      );
    }
    if (
      crawled.documents.length > ORGANIZATION_LIMITS.crawlPages ||
      crawled.visited > ORGANIZATION_LIMITS.crawlSitemapUrls ||
      crawled.skipped > ORGANIZATION_LIMITS.crawlSitemapUrls
    )
      throw new AuthorizationError(
        502,
        "INTERNAL_ERROR",
        "The documentation site returned an invalid bounded crawl result.",
      );
    const sources: z.infer<typeof knowledgeSourceSchema>[] = [];
    let skipped = crawled.skipped;
    for (const page of crawled.documents) {
      context.signal.throwIfAborted();
      let pageUrl: URL;
      try {
        pageUrl = new URL(page.url);
        const seed = new URL(input.url);
        const slash = seed.pathname.lastIndexOf("/");
        const section = seed.pathname.endsWith("/")
          ? seed.pathname
          : /\.[a-z0-9]{1,8}$/i.test(seed.pathname)
            ? seed.pathname.slice(0, slash + 1) || "/"
            : seed.pathname + "/";
        if (
          pageUrl.protocol !== "https:" ||
          pageUrl.origin !== input.origin ||
          pageUrl.href !== page.url ||
          pageUrl.search ||
          pageUrl.hash ||
          !(
            pageUrl.pathname.startsWith(section) ||
            pageUrl.pathname === section.slice(0, -1)
          ) ||
          Buffer.byteLength(page.html, "utf8") >
            ORGANIZATION_LIMITS.crawlPageBytes ||
          page.title.length > 120
        ) {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue;
      }
      let text: string;
      try {
        text = await this.converter.extract(
          {
            format: "html",
            base64: Buffer.from(page.html, "utf8").toString("base64"),
          },
          context,
        );
        context.signal.throwIfAborted();
      } catch (error) {
        context.signal.throwIfAborted();
        skipped++;
        continue;
      }
      const document = knowledgeDocumentSchema.safeParse({
        schemaVersion: 1,
        title: page.title || pageUrl.pathname,
        origin: input.origin,
        sourceUrl: pageUrl.href,
        format: "html",
        text,
      });
      if (!document.success) {
        skipped++;
        continue;
      }
      sources.push(
        await this.saveSource(principal, workspaceId, document.data, context),
      );
    }
    if (!sources.length)
      throw new AuthorizationError(
        422,
        "INVALID_REQUEST",
        "No readable public documentation pages were found in that approved section.",
      );
    return publicDocumentationCrawlResultSchema.parse({
      schemaVersion: 1,
      visited: crawled.visited,
      skipped,
      sources,
    });
  }
  deleteSource(
    principal: Principal,
    workspaceId: string,
    id: string,
    revision: string,
    context: ServiceRequestContext,
  ) {
    z.string().uuid().parse(id);
    organizationWorkflowActionSchema.shape.expectedRevision.parse(revision);
    return this.run(
      principal,
      workspaceId,
      "organization.publish",
      context,
      (s) => s.deleteSource(id, revision),
    );
  }
  retrieve(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = knowledgeQuerySchema.parse(raw);
    return this.run(
      principal,
      workspaceId,
      "organization.read",
      context,
      async (s) => {
        const policy = await s.policy();
        if (!policy.policy.allowedOrigins.includes(input.origin))
          return documentaryRetrievalSchema.parse({
            schemaVersion: 1,
            snapshot: organizationDigest([]),
            bundles: [],
          });
        const candidates = await s.chunks(input.origin),
          scores = bm25(
            input.query,
            candidates.map((c) => c.text),
          );
        const bundles: DocumentaryBundle[] = [];
        for (const { bundle, score } of candidates
          .map((bundle, i) => ({ bundle, score: scores[i] }))
          .sort((a, b) => b.score - a.score)) {
          if (
            score <= 0 ||
            bundles.length === ORGANIZATION_LIMITS.retrievalBundles
          )
            break;
          if (
            Buffer.byteLength(JSON.stringify([...bundles, bundle])) <=
            ORGANIZATION_LIMITS.retrievalBytes - 200
          )
            bundles.push(bundle);
        }
        context.signal.throwIfAborted();
        return documentaryRetrievalSchema.parse({
          schemaVersion: 1,
          snapshot: organizationDigest([policy.revision, bundles]),
          bundles,
        });
      },
    );
  }
}
