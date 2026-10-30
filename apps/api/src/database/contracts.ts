import type { SavedTask } from "../../../../packages/page-model";
import type { DatabaseScope } from "./postgres";
import type {
  JobErrorCode,
  JobResult,
} from "../../../../packages/navigation-core/contracts-jobs";

export type RepositoryScope = DatabaseScope;

export type RepositoryErrorCode =
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INSUFFICIENT_CREDITS";

export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface Account {
  id: string;
  status: "active" | "suspended" | "deletion_pending" | "deleted";
  revision: bigint;
}

export interface Membership {
  accountId: string;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
  revision: bigint;
}

export interface Workspace {
  id: string;
  kind: "personal" | "organization";
  ownerAccountId: string;
  revision: bigint;
}

export interface Consent {
  id: string;
  purpose: string;
  policyVersion: string;
  granted: boolean;
  revision: bigint;
}

export type RequestStatus = "pending" | "completed" | "failed" | "uncertain";
export interface ServiceRequest {
  id: string;
  operation: string;
  idempotencyKey: string;
  payloadHash: string;
  status: RequestStatus;
}

export interface PlanVersion {
  planId: string;
  version: number;
  name: string;
  definition: Record<string, unknown>;
}

export interface Entitlement {
  id: string;
  planId: string;
  planVersion: number;
  status: "active" | "suspended" | "ended";
  startsAt: Date;
  endsAt: Date | null;
  revision: bigint;
}

export interface CreditGrant {
  id: string;
  amount: bigint;
  expiresAt: Date | null;
}

export type ReservationStatus = "active" | "settled" | "released" | "uncertain";
export interface CreditReservation {
  id: string;
  requestId: string;
  amount: bigint;
  status: ReservationStatus;
  expiresAt: Date;
}

export interface CreditSettlement {
  id: string;
  reservationId: string;
  amount: bigint;
}

export interface CreditBalance {
  granted: bigint;
  spent: bigint;
  reserved: bigint;
  available: bigint;
}

export interface UsageRecord {
  id: string;
  requestId: string;
  provider: string;
  model: string;
  inputUnits: bigint;
  outputUnits: bigint;
}

export interface SavedArtifact {
  id: string;
  ownerAccountId: string;
  kind: "saved_route";
  content: SavedTask | null;
  revision: bigint;
  syncRevision: bigint;
  deletedAt: Date | null;
}

export interface ArtifactPage {
  items: SavedArtifact[];
  nextCursor?: bigint;
}

export interface RecordReferences {
  accountId?: string;
  artifactId?: string;
  requestId?: string;
}

export interface Job {
  id: string;
  accountId: string;
  requestId: string | null;
  kind: string;
  version: number;
  recordReferences: RecordReferences;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "dead"
    | "cancelled"
    | "uncertain";
  availableAt: Date;
  maxAttempts: number;
  revision: bigint;
  attempts: number;
  cancelRequested: boolean;
  errorCode: JobErrorCode | null;
  result: JobResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxEntry {
  id: string;
  jobId: string;
  eventKind: string;
  status: "pending" | "published";
  availableAt: Date;
}
