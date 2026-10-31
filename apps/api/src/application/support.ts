import { createHash } from "node:crypto";
import { z } from "zod";
import apiPackage from "../../package.json" with { type: "json" };
import {
  diagnosticInputSchema,
  diagnosticSchema,
  fileDownloadQuerySchema,
  fileLinkInputSchema,
  fileLinkSchema,
  privateFileSchema,
  supportInputSchema,
  supportRequestSchema,
  SUPPORT_LIMITS,
} from "../../../../packages/navigation-core/contracts-support";
import type { ServiceRequestContext } from "../capabilities";
import { RepositoryError } from "../database/contracts";
import {
  AuthorizationError,
  authorizationRepositoryFailure,
} from "./authorization";
import type { IdentitySession } from "./identity-contracts";
import { validatePrivateFile } from "./private-files";
import type {
  FileLinks,
  ObjectPort,
  PrivateFile,
  SupportOptions,
  SupportStore,
} from "./support-contracts";

type Principal = Pick<IdentitySession, "accountId" | "workspaceId">;
const identifier = z.string().uuid();
const unavailable = () =>
  new AuthorizationError(404, "NOT_FOUND", "The file is unavailable.");
const hashCommand = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** HTTP account authority is server-derived; the store rechecks current records in every transaction. */
export class SupportService {
  constructor(
    private readonly store: SupportStore,
    private readonly objects: ObjectPort,
    private readonly links: FileLinks,
    private readonly options: SupportOptions,
  ) {}

  private scope(principal: Principal) {
    return Object.freeze({
      accountId: identifier.parse(principal.accountId),
      workspaceId: identifier.parse(principal.workspaceId),
    });
  }

  private async operation<T>(
    context: ServiceRequestContext,
    work: () => Promise<T>,
  ) {
    context.signal.throwIfAborted();
    try {
      const result = await work();
      context.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "RATE_LIMITED")
        throw new AuthorizationError(
          429,
          "RATE_LIMITED",
          "The request limit has been reached. Try again later.",
        );
      return authorizationRepositoryFailure(error);
    }
  }

  async submit(
    principal: Principal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const scope = this.scope(principal);
    const input = supportInputSchema.parse(raw);
    return this.operation(context, async () => {
      const record = await this.store.submit(
        scope,
        {
          ...input,
          payloadHash: hashCommand({ ...input, idempotencyKey: undefined }),
        },
        context.signal,
      );
      return supportRequestSchema.parse({
        ...record,
        expiresAt: record.expiresAt.toISOString(),
      });
    });
  }

  async diagnostic(
    principal: Principal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const scope = this.scope(principal);
    const input = diagnosticInputSchema.parse(raw);
    return this.operation(context, async () =>
      diagnosticSchema.parse(
        await this.store.requestDiagnostic(
          scope,
          {
            ...input,
            version: apiPackage.version,
            payloadHash: hashCommand({
              schemaVersion: 1,
              version: apiPackage.version,
            }),
          },
          context.signal,
        ),
      ),
    );
  }

  private async file(
    scope: Principal,
    fileId: string,
    context: ServiceRequestContext,
  ) {
    const file = await this.store.getFile(scope, fileId, context.signal);
    context.signal.throwIfAborted();
    if (
      !file ||
      file.expiresAt.getTime() <= Date.now() ||
      file.status === "deleted" ||
      file.status === "deleting"
    )
      throw unavailable();
    return file;
  }

  private publicFile(file: PrivateFile) {
    return privateFileSchema.parse({
      id: file.id,
      requestId: file.requestId,
      revision: file.revision.toString(),
      expiresAt: file.expiresAt.toISOString(),
      status: file.status,
    });
  }

  async getFile(
    principal: Principal,
    fileId: string,
    context: ServiceRequestContext,
  ) {
    const scope = this.scope(principal);
    const id = identifier.parse(fileId);
    return this.operation(context, async () =>
      this.publicFile(await this.file(scope, id, context)),
    );
  }

  async fileLink(
    principal: Principal,
    fileId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const scope = this.scope(principal);
    const id = identifier.parse(fileId);
    const input = fileLinkInputSchema.parse(raw);
    return this.operation(context, async () => {
      const file = await this.file(scope, id, context);
      if (file.status !== "ready") throw unavailable();
      if (file.revision.toString() !== input.expectedRevision)
        throw new AuthorizationError(
          409,
          "CONFLICT",
          "The file has changed. Refresh before downloading.",
        );
      const expiresAt = new Date(
        Math.floor(
          Math.min(
            file.expiresAt.getTime(),
            Date.now() +
              Math.min(
                this.options.linkLifetimeMs,
                SUPPORT_LIMITS.maxLinkLifetimeMs,
              ),
          ) / 1000,
        ) * 1000,
      );
      const token = await this.links.issue({
        ...scope,
        workspaceId: file.workspaceId ?? scope.workspaceId,
        fileId: id,
        revision: input.expectedRevision,
        expiresAt,
      });
      const url = new URL(
        `/api/v1/account/files/${id}/download`,
        this.options.publicOrigin,
      );
      url.searchParams.set("token", token);
      return fileLinkSchema.parse({
        url: url.href,
        expiresAt: expiresAt.toISOString(),
      });
    });
  }

  async download(
    principal: Principal,
    fileId: string,
    rawToken: string,
    context: ServiceRequestContext,
    finalIdentityCheck?: () => Promise<void>,
  ) {
    const scope = this.scope(principal);
    const id = identifier.parse(fileId);
    const { token } = fileDownloadQuerySchema.parse({ token: rawToken });
    return this.operation(context, async () => {
      let proof: Awaited<ReturnType<FileLinks["verify"]>>;
      try {
        proof = await this.links.verify(token);
      } catch {
        throw unavailable();
      }
      if (proof.accountId !== scope.accountId || proof.fileId !== id)
        throw unavailable();
      const file = await this.file(scope, id, context);
      if (
        proof.workspaceId !== (file.workspaceId ?? scope.workspaceId) ||
        file.status !== "ready" ||
        file.revision.toString() !== proof.revision
      )
        throw unavailable();
      const body = await this.objects.read(file, context.signal);
      validatePrivateFile(file, body);
      const currentProof = await this.links.verify(token).catch(() => {
        throw unavailable();
      });
      await finalIdentityCheck?.();
      // Authorization, expiry and revision can change while S3 is in flight.
      const current = await this.file(scope, id, context);
      if (
        current.status !== "ready" ||
        current.revision !== file.revision ||
        current.key !== file.key ||
        current.workspaceId !== file.workspaceId ||
        current.sha256 !== file.sha256 ||
        currentProof.expiresAt.getTime() <= Date.now()
      )
        throw unavailable();
      return {
        body,
        contentType: "application/json" as const,
        filename:
          file.purpose === "account-export-manifest"
            ? "tholi-account-manifest.json"
            : file.purpose === "account-export-part"
              ? "tholi-account-part.json"
              : file.purpose === "saved-data-export"
                ? "tholi-saved-data.json"
                : "tholi-diagnostic.json",
      };
    });
  }
}
