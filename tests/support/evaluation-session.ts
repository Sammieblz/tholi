import { open, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { identityTokensSchema } from "../../packages/navigation-core/contracts-identity";
import { serviceOrigin } from "../../packages/navigation-core/service-client";
import { z } from "zod";

const originSchema = z
  .string()
  .transform((value) => serviceOrigin(value))
  .refine((value) => new URL(value).hostname === "127.0.0.1");
export const nativeEvaluationSessionSchema = z
  .object({
    version: z.literal(1),
    serviceOrigin: originSchema,
    authorizationOrigin: originSchema.optional(),
    callback: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          /^[a-p]{32}\.chromiumapp\.org$/.test(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }),
    clientId: z.literal("extension-chromium"),
    tokens: identityTokensSchema,
  })
  .strict();

/** One bounded private input reader; values never enter experiment reports. */
export async function readNativeEvaluationSession(file: string) {
  const handle = await open(file, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 8192)
      throw Error("A bounded native session file is required.");
    const bytes = Buffer.alloc(8193);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > 8192)
      throw Error("The native session file exceeds its bound.");
    return nativeEvaluationSessionSchema.parse(
      JSON.parse(bytes.subarray(0, length).toString("utf8")),
    );
  } finally {
    await handle.close();
  }
}

/** A consumed or uncertain initial refresh token cannot be replayed by another collector. */
export async function claimNativeEvaluationSession(
  raw: z.infer<typeof nativeEvaluationSessionSchema>,
  directory = resolve("output/qa/evaluation-session-claims"),
) {
  const session = nativeEvaluationSessionSchema.parse(raw);
  const fingerprint = createHash("sha256")
    .update(session.tokens.refreshToken)
    .digest("hex");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let marker;
  try {
    marker = await open(join(directory, `${fingerprint}.json`), "wx", 0o600);
  } catch {
    throw Error(
      "This native session has already been claimed or cannot be claimed. Bootstrap a fresh session.",
    );
  }
  try {
    await marker.writeFile(
      JSON.stringify({ version: 1, claimedAtMs: Date.now() }) + "\n",
    );
    await marker.sync();
  } finally {
    await marker.close();
  }
}
