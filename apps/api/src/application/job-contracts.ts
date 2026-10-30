import type {
  JobErrorCode,
  JobResult,
} from "../../../../packages/navigation-core/contracts-jobs";
import type { RecordReferences } from "../database/contracts";
import type { AuthorizationContextReader } from "./authorization-policy";

export interface JobKind {
  kind: string;
  version: number;
  replaySafe: boolean;
}

/** Internal claim credentials never form part of the public job representation. */
export interface JobLease {
  id: string;
  workspaceId: string;
  accountId: string;
  kind: string;
  version: number;
  recordReferences: RecordReferences;
  attempts: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}

/** Narrow, fenced transaction capabilities for the registered maintenance handler. */
export interface JobTransaction extends AuthorizationContextReader {
  pruneExpiredBrokers(limit: number): Promise<number>;
}

export type JobFailureClassification = "retryable" | "failed" | "uncertain";
export interface JobFailure {
  classification: JobFailureClassification;
  code: JobErrorCode;
  backoffMs: number;
}

export interface JobStore {
  claim(input: {
    workerId: string;
    kinds: readonly JobKind[];
    leaseMs: number;
    limit: number;
  }): Promise<JobLease[]>;
  heartbeat(
    lease: JobLease,
    leaseMs: number,
  ): Promise<{ alive: boolean; cancelRequested: boolean }>;
  fail(lease: JobLease, failure: JobFailure): Promise<boolean>;
  /** Database time and an actor/slot key make competing schedulers idempotent. */
  scheduleBrokerPruning(input: {
    limit: number;
    intervalMs: number;
  }): Promise<number>;
  /** Effect, result and database-local completion outbox acknowledgement commit together. */
  runJob(
    lease: JobLease,
    work: (transaction: JobTransaction) => Promise<JobResult>,
  ): Promise<boolean>;
}

export interface JobHandler extends JobKind {
  execute(
    transaction: JobTransaction,
    lease: JobLease,
    signal: AbortSignal,
  ): Promise<JobResult>;
}

/** Only bounded, stable codes may leave a handler; raw failure messages are discarded. */
export class JobHandlerFailure extends Error {
  constructor(
    readonly classification: JobFailureClassification,
    readonly code: JobErrorCode,
  ) {
    super(code);
    this.name = "JobHandlerFailure";
  }
}

export interface JobWorkerOptions {
  workerId: string;
  concurrency: number;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  maxBackoffMs: number;
  scheduleIntervalMs: number;
}
