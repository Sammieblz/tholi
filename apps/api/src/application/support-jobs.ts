import { ZodError } from "zod";
import { registeredJobKinds, type ExternalJobHandler } from "./job-contracts";
import {
  validateDiagnosticFile,
  validateSavedDataFile,
  validateAccountFile,
  validateObjectReference,
} from "./private-files";
import { approvedMailSchema } from "./support-mail";
import { NO_OBSERVABILITY, type Observability } from "./observability";
import type { JobLease } from "./job-contracts";
import type {
  ExternalOutcome,
  MailPort,
  ObjectPort,
  SupportStore,
} from "./support-contracts";

const kinds = [
  "support.operator",
  "support.received",
  "file.diagnostic",
  "file.saved-data-export",
  "file.account-export-part",
  "file.account-export-manifest",
  "file.expire",
] as const;
export const SUPPORT_JOB_KINDS = registeredJobKinds(
  kinds.map((kind) => ({ kind, version: 1, replaySafe: true })),
);

/** The durable start barrier makes orchestration replay safe; SMTP itself is never idempotent. */
export function createSupportJobHandlers(
  store: SupportStore,
  mail: MailPort,
  objects: ObjectPort,
  observer: Observability = NO_OBSERVABILITY,
): readonly ExternalJobHandler[] {
  const finish = async (
    lease: JobLease,
    outcome: ExternalOutcome,
    work: () => Promise<boolean>,
  ) => {
    if (!observer.enabled) return work();
    const span = observer.start("job.acknowledge", {
      jobKind: lease.kind,
      attempt: lease.attempts,
    });
    try {
      const changed = await work();
      span.end(
        changed
          ? outcome.status === "committed"
            ? "ok"
            : outcome.status === "failed"
              ? "error"
              : outcome.status
          : "stale",
        { ...(outcome.code ? { errorCode: outcome.code } : {}) },
      );
      if (!changed)
        observer.metric("job.stale_fences", 1, { jobKind: lease.kind });
      return changed;
    } catch (error) {
      span.end("unavailable");
      throw error;
    }
  };
  const execute: ExternalJobHandler["execute"] = async (
    lease,
    signal,
    backoffMs,
  ) => {
    if (lease.kind === "file.expire") {
      const prepared = await store.prepareCleanup(lease);
      if (!prepared) return;
      let outcome: ExternalOutcome;
      try {
        validateObjectReference(prepared.file);
        await objects.delete(prepared.file, signal);
        outcome = { status: "committed", backoffMs: 0 };
      } catch {
        // Expiry is mandatory, even after user cancellation or membership removal.
        outcome = { status: "retryable", code: "UNAVAILABLE", backoffMs };
      }
      await finish(lease, outcome, () =>
        store.finishCleanup(lease, prepared.attemptId, outcome),
      );
      return;
    }
    const prepared = await store.prepareExternal(lease);
    if (!prepared) return;
    let outcome: ExternalOutcome;
    try {
      if (signal.aborted) {
        // No adapter was invoked after this attempt's start barrier.
        outcome = { status: "retryable", code: "SHUTDOWN", backoffMs };
      } else if (prepared.command.type === "mail") {
        const command = approvedMailSchema.parse(prepared.command.message);
        if (lease.kind !== command.template) throw new ZodError([]);
        const receipt = await mail.send(command, signal);
        outcome =
          receipt === "accepted"
            ? { status: "committed", backoffMs: 0 }
            : receipt === "not-sent"
              ? { status: "retryable", code: "UNAVAILABLE", backoffMs }
              : { status: "uncertain", code: "HANDLER_FAILED", backoffMs: 0 };
      } else {
        if (
          [
            "file.saved-data-export",
            "file.account-export-part",
            "file.account-export-manifest",
          ].includes(lease.kind)
        ) {
          if (lease.kind === "file.saved-data-export")
            validateSavedDataFile(prepared.command.file, prepared.command.body);
          else
            validateAccountFile(prepared.command.file, prepared.command.body);
          if (!(await store.authorizeExternal?.(lease, prepared.attemptId)))
            throw new ZodError([]);
          signal.throwIfAborted();
        } else if (lease.kind === "file.diagnostic") {
          validateDiagnosticFile(prepared.command.file, prepared.command.body);
        } else throw new ZodError([]);
        await objects.put(prepared.command.file, prepared.command.body, signal);
        outcome = { status: "committed", backoffMs: 0 };
      }
    } catch (error) {
      outcome =
        error instanceof ZodError
          ? { status: "failed", code: "HANDLER_FAILED", backoffMs: 0 }
          : prepared.command.type === "mail"
            ? { status: "uncertain", code: "HANDLER_FAILED", backoffMs: 0 }
            : { status: "retryable", code: "UNAVAILABLE", backoffMs };
    }
    // A finish failure leaves the durable started barrier in place. A future
    // claim may reconcile or mark uncertainty, but cannot send that SMTP effect again.
    await finish(lease, outcome, () =>
      store.finishExternal(lease, prepared.attemptId, outcome),
    );
  };
  return Object.freeze(
    SUPPORT_JOB_KINDS.map((kind) =>
      Object.freeze({
        ...kind,
        external: true as const,
        execute,
        ...(kind.kind === "file.expire"
          ? {
              schedule: (input: { limit: number; intervalMs: number }) =>
                store.scheduleFileExpiry(input),
            }
          : {}),
      }),
    ),
  );
}
