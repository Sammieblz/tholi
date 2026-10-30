import { z } from "zod";
import {
  cancelJobInputSchema,
  jobPageQuerySchema,
  jobPageSchema,
  jobSchema,
  type JobPageQuery,
} from "../../../../packages/navigation-core/contracts-jobs";
import type { ServiceRequestContext } from "../capabilities";
import type { Job as StoredJob } from "../database/contracts";
import type { IdentitySession } from "./identity-contracts";
import type { AuthorizationContextReader } from "./authorization-policy";
import {
  AuthorizationError,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";

export interface JobTransaction extends AuthorizationContextReader {
  listJobs(query?: Partial<JobPageQuery>): Promise<StoredJob[]>;
  getJob(id: string): Promise<StoredJob | undefined>;
  cancelJob(input: {
    id: string;
    expectedRevision: bigint;
  }): Promise<StoredJob>;
}
export type JobRepositories = AuthorizedRepositories<JobTransaction>;
type Principal = Pick<IdentitySession, "accountId">;
const identifier = z.string().uuid();
const unavailable = () =>
  new AuthorizationError(404, "NOT_FOUND", "The job is unavailable.");

/** Rebuild the public view; internal payloads and lease credentials never serialize. */
function publicJob(row: StoredJob, actorId: string) {
  if (row.accountId !== actorId) throw unavailable();
  return jobSchema.parse({
    id: row.id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    revision: row.revision.toString(),
    cancelRequested: row.cancelRequested,
    errorCode: row.errorCode,
    result: row.result,
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Account sessions select scope; jobs remain actor-private even for organization admins. */
export class JobService {
  constructor(private readonly repositories: JobRepositories) {}

  async list(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const query = jobPageQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "jobs.read",
      async (repository, authorization) => {
        const items = (await repository.listJobs(query)).map((row) =>
          publicJob(row, authorization.account.id),
        );
        return jobPageSchema.parse({
          items,
          ...(items.length === query.limit
            ? { nextCursor: items.at(-1)!.id }
            : {}),
        });
      },
      context,
    );
  }

  async get(
    principal: Principal,
    workspaceId: string,
    jobId: string,
    context: ServiceRequestContext,
  ) {
    const id = identifier.parse(jobId);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "jobs.read",
      async (repository, authorization) => {
        const row = await repository.getJob(id);
        if (!row) throw unavailable();
        return publicJob(row, authorization.account.id);
      },
      context,
    );
  }

  async cancel(
    principal: Principal,
    workspaceId: string,
    jobId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const id = identifier.parse(jobId);
    const input = cancelJobInputSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "jobs.cancel",
      async (repository, authorization) => {
        const existing = await repository.getJob(id);
        if (!existing) throw unavailable();
        publicJob(existing, authorization.account.id);
        return publicJob(
          await repository.cancelJob({
            id,
            expectedRevision: BigInt(input.expectedRevision),
          }),
          authorization.account.id,
        );
      },
      context,
    );
  }
}
