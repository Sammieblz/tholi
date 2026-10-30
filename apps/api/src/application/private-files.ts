import { createHash } from "node:crypto";
import { z } from "zod";
import {
  diagnosticSnapshotSchema,
  SUPPORT_LIMITS,
} from "../../../../packages/navigation-core/contracts-support";
import type { PrivateFile } from "./support-contracts";

const generatedKey =
  /^exports\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.json$/;
export function validateObjectReference(file: Pick<PrivateFile, "id" | "key">) {
  z.string().uuid().parse(file.id);
  const match = generatedKey.exec(file.key);
  if (!match || match[2] !== file.id)
    throw new Error("The private file reference is invalid.");
}

export function diagnosticBytes(value: unknown) {
  const body = Buffer.from(
    JSON.stringify(diagnosticSnapshotSchema.parse(value)),
    "utf8",
  );
  if (body.byteLength > SUPPORT_LIMITS.maxFileBytes)
    throw new Error("The diagnostic exceeds its size limit.");
  return {
    body,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

/** Validate both generated metadata and the actual bytes before storing or serving. */
export function validateDiagnosticFile(file: PrivateFile, body: Uint8Array) {
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
  return diagnosticSnapshotSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
  );
}
