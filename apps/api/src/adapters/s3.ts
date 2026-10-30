import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  validateDiagnosticFile,
  validateObjectReference,
} from "../application/private-files";
import type {
  ObjectPort,
  ObjectStorageOptions,
} from "../application/support-contracts";
import { validateObjectStorageOptions } from "../config";

/** Private S3-compatible adapter shared by local SeaweedFS, VM and hosted buckets. */
export function createS3Objects(
  input: ObjectStorageOptions,
  allowLocal = false,
): ObjectPort & { ready(): Promise<boolean> } {
  const options = validateObjectStorageOptions(input, allowLocal);
  const httpAgent = new HttpAgent({
    keepAlive: true,
    maxSockets: 4,
    maxTotalSockets: 4,
  });
  const httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxSockets: 4,
    maxTotalSockets: 4,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
  });
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
    forcePathStyle: true,
    maxAttempts: 1,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new NodeHttpHandler({
      httpAgent,
      httpsAgent,
      connectionTimeout: Math.min(3000, options.timeoutMs),
      requestTimeout: options.timeoutMs,
      throwOnRequestTimeout: true,
      socketTimeout: options.timeoutMs,
    }),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  let closed = false;
  const operationSignal = (signal: AbortSignal) => {
    if (closed) throw new Error("Private storage is closed.");
    signal.throwIfAborted();
    return AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
  };
  return {
    async ready() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: options.bucket }), {
          abortSignal: operationSignal(new AbortController().signal),
        });
        return true;
      } catch {
        return false;
      }
    },
    async put(rawFile, rawBody, signal) {
      const file = { ...rawFile };
      const body = Buffer.from(rawBody);
      validateDiagnosticFile(file, body);
      if (body.byteLength > options.maxBytes)
        throw new Error("The private file exceeds its size limit.");
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: file.key,
            Body: body,
            ContentType: file.contentType,
            ContentLength: body.byteLength,
            ChecksumSHA256: Buffer.from(file.sha256, "hex").toString("base64"),
          }),
          { abortSignal: operationSignal(signal) },
        );
      } catch {
        throw new Error("Private storage is unavailable.");
      }
    },
    async read(rawFile, signal) {
      const file = { ...rawFile };
      validateObjectReference(file);
      if (
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        file.bytes > options.maxBytes
      )
        throw new Error("The private file exceeds its size limit.");
      const active = operationSignal(signal);
      let body:
        (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: file.key }),
          { abortSignal: active },
        );
        body = result.Body as typeof body;
        if (
          result.ContentLength !== file.bytes ||
          result.ContentType !== file.contentType ||
          !result.Body
        )
          throw new Error();
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body!) {
          active.throwIfAborted();
          size += chunk.byteLength;
          if (size > file.bytes || size > options.maxBytes) throw new Error();
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        validateDiagnosticFile(file, bytes);
        return bytes;
      } catch {
        throw new Error("The private file could not be retrieved.");
      } finally {
        body?.destroy?.();
      }
    },
    async delete(rawFile, signal) {
      const file = { ...rawFile };
      validateObjectReference(file);
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: options.bucket, Key: file.key }),
          { abortSignal: operationSignal(signal) },
        );
      } catch {
        throw new Error("Private file deletion is unavailable.");
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      client.destroy();
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}
