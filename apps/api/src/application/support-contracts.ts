import type { JobErrorCode } from "../../../../packages/navigation-core/contracts-jobs";
import type {
  SupportInput,
  DiagnosticSnapshot,
} from "../../../../packages/navigation-core/contracts-support";
import type { RepositoryScope } from "../database/contracts";
import type { JobLease } from "./job-contracts";

export type SupportTopic = SupportInput["topic"];
export type { DiagnosticSnapshot };
export interface SupportCommand extends SupportInput {
  payloadHash: string;
}
export interface SupportRecord {
  id: string;
  operatorJobId: string;
  receiptJobId: string | null;
  expiresAt: Date;
}
export interface DiagnosticRecord {
  requestId: string;
  jobId: string;
  fileId: string;
}
export interface PrivateFile {
  id: string;
  /** Actual owned file scope; absent only in legacy in-memory adapter fixtures. */
  workspaceId?: string;
  requestId: string;
  revision: bigint;
  key: string;
  bytes: number;
  sha256: string;
  contentType: "application/json";
  expiresAt: Date;
  status: "pending" | "ready" | "deleting" | "deleted";
  /** Missing only in legacy adapter fixtures; database rows always select it. */
  purpose?: "diagnostic" | "saved-data-export";
}
export type ApprovedMail =
  | {
      template: "support.operator";
      templateVersion: 1;
      messageId: string;
      requestId: string;
      name?: string;
      email: string;
      topic: SupportTopic;
      subject: string;
      message: string;
    }
  | {
      template: "support.received";
      templateVersion: 1;
      messageId: string;
      requestId: string;
      recipient: string;
      subject: string;
    };
export interface PreparedExternal {
  attemptId: string;
  effectId: string;
  commandHash: string;
  command:
    | { type: "mail"; message: ApprovedMail }
    | { type: "put"; file: PrivateFile; body: Uint8Array };
}
export interface PreparedCleanup {
  attemptId: string;
  effectId: string;
  commandHash: string;
  file: Pick<PrivateFile, "id" | "key">;
}
export interface ExternalOutcome {
  status: "committed" | "retryable" | "uncertain" | "failed";
  code?: JobErrorCode;
  backoffMs: number;
}
/** All methods own short transactions. No callback may hold SQL during adapter I/O. */
export interface SupportStore {
  submit(
    scope: RepositoryScope,
    command: SupportCommand,
    signal?: AbortSignal,
  ): Promise<SupportRecord>;
  requestDiagnostic(
    scope: RepositoryScope,
    input: { idempotencyKey: string; payloadHash: string; version: string },
    signal?: AbortSignal,
  ): Promise<DiagnosticRecord>;
  getFile(
    scope: RepositoryScope,
    fileId: string,
    signal?: AbortSignal,
  ): Promise<PrivateFile | null>;
  /** A prior started SMTP attempt without a committed outcome returns no send command. */
  prepareExternal(lease: JobLease): Promise<PreparedExternal | null>;
  /** New saved-data PUTs fail closed without this final current-authority fence. */
  authorizeExternal?(lease: JobLease, attemptId: string): Promise<boolean>;
  finishExternal(
    lease: JobLease,
    attemptId: string,
    outcome: ExternalOutcome,
  ): Promise<boolean>;
  /** Worker-only expiry capability: active membership is deliberately not required. */
  prepareCleanup(lease: JobLease): Promise<PreparedCleanup | null>;
  finishCleanup(
    lease: JobLease,
    attemptId: string,
    outcome: ExternalOutcome,
  ): Promise<boolean>;
  /** Also purges bounded expired support content, including inactive/deleted owners. */
  scheduleFileExpiry(input: {
    limit: number;
    intervalMs: number;
  }): Promise<number>;
}
export type MailOutcome = "accepted" | "not-sent" | "uncertain";
export interface MailPort {
  send(command: ApprovedMail, signal: AbortSignal): Promise<MailOutcome>;
  close(): Promise<void>;
}
export interface ObjectPort {
  put(file: PrivateFile, body: Uint8Array, signal: AbortSignal): Promise<void>;
  read(file: PrivateFile, signal: AbortSignal): Promise<Uint8Array>;
  delete(
    file: Pick<PrivateFile, "id" | "key">,
    signal: AbortSignal,
  ): Promise<void>;
  close(): Promise<void>;
}
export interface FileLinks {
  issue(input: {
    accountId: string;
    workspaceId: string;
    fileId: string;
    revision: string;
    expiresAt: Date;
  }): Promise<string>;
  verify(token: string): Promise<{
    accountId: string;
    workspaceId: string;
    fileId: string;
    revision: string;
    expiresAt: Date;
  }>;
}
export interface SupportOptions {
  publicOrigin: string;
  linkLifetimeMs: number;
}
export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  from: string;
  supportRecipient: string;
  user?: string;
  password?: string;
  localCapture: boolean;
  timeoutMs: number;
}
export interface ObjectStorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  maxBytes: number;
  timeoutMs: number;
}
