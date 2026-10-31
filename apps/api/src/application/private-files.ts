import { createHash } from "node:crypto";
import { z } from "zod";
import {
  diagnosticSnapshotSchema,
  SUPPORT_LIMITS,
} from "../../../../packages/navigation-core/contracts-support";
import type { PrivateFile } from "./support-contracts";
import { savedDataExportSnapshotSchema } from "../../../../packages/navigation-core/contracts-saved-data";

const generatedKey =
  /^exports\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.json$/;
export function validateObjectReference(file: Pick<PrivateFile, "id" | "key">) {
  z.string().uuid().parse(file.id);
  const match = generatedKey.exec(file.key);
  if (!match || match[2] !== file.id)
    throw new Error("The private file reference is invalid.");
}

export function diagnosticBytes(value: unknown) {
  return encodedBytes(diagnosticSnapshotSchema.parse(value));
}

export function savedDataExportBytes(value: unknown) {
  return encodedBytes(savedDataExportSnapshotSchema.parse(value));
}

function encodedBytes(value: unknown) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.byteLength > SUPPORT_LIMITS.maxFileBytes)
    throw new Error("The private export exceeds its size limit.");
  return {
    body,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

/** Validate both generated metadata and the actual bytes before storing or serving. */
function verifiedJson(file: PrivateFile, body: Uint8Array): unknown {
  validateObjectReference(file);
  if (
    file.contentType !== "application/json" ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 1 ||
    file.bytes > SUPPORT_LIMITS.maxFileBytes ||
    body.byteLength !== file.bytes ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    createHash("sha256").update(body).digest("hex") !== file.sha256
  )
    throw new Error("The private file could not be verified.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

export function validateDiagnosticFile(file: PrivateFile, body: Uint8Array) {
  if (file.purpose !== undefined && file.purpose !== "diagnostic")
    throw new Error("The private export purpose is invalid.");
  return diagnosticSnapshotSchema.parse(verifiedJson(file, body));
}

export function validateSavedDataFile(file: PrivateFile, body: Uint8Array) {
  if (file.purpose !== "saved-data-export")
    throw new Error("The private export purpose is invalid.");
  return savedDataExportSnapshotSchema.parse(verifiedJson(file, body));
}

export function validatePrivateFile(file: PrivateFile, body: Uint8Array) {
  return file.purpose === "saved-data-export"
    ? validateSavedDataFile(file, body)
    : validateDiagnosticFile(file, body);
}
