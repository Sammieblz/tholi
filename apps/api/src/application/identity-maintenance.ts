import { z } from "zod";
import { jobResultSchema } from "../../../../packages/navigation-core/contracts-jobs";
import {
  evaluateAuthorization,
  readAuthorizationContext,
} from "./authorization-policy";
import {
  JobHandlerFailure,
  registeredJobKinds,
  type JobHandler,
} from "./job-contracts";

const brokerReferences = z.object({ accountId: z.string().uuid() }).strict();

/** Authentication metadata cleanup does not grant cloud processing or upload consent. */
export const pruneExpiredBrokers = Object.freeze<JobHandler>({
  kind: "identity.prune-expired-brokers",
  version: 1,
  replaySafe: true,
  async execute(transaction, lease, signal) {
    signal.throwIfAborted();
    const references = brokerReferences.safeParse(lease.recordReferences);
    if (!references.success || references.data.accountId !== lease.accountId)
      throw new JobHandlerFailure("failed", "UNSUPPORTED_JOB");
    const context = await readAuthorizationContext(transaction);
    signal.throwIfAborted();
    if (
      context.account.id !== lease.accountId ||
      context.workspace?.id !== lease.workspaceId ||
      context.workspace?.kind !== "personal" ||
      !evaluateAuthorization(context, "jobs.read").allowed
    )
      throw new JobHandlerFailure("failed", "AUTHORIZATION_REVOKED");
    const processed = await transaction.pruneExpiredBrokers(100);
    // Abort after SQL rolls back its effect through runJob's transaction owner.
    signal.throwIfAborted();
    return jobResultSchema.parse({ processed });
  },
});

export const JOB_HANDLERS: readonly JobHandler[] = Object.freeze([
  pruneExpiredBrokers,
]);
/** The operator recovery command uses the same kind/version/replay policy as workers. */
export const REGISTERED_JOB_KINDS = registeredJobKinds(JOB_HANDLERS);
