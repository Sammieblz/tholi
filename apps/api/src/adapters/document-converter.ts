import { z } from "zod";
import { createAdapterHttp, checkAdapterHttpResponse } from "./adapter-http";
import { AuthorizationError } from "../application/authorization";
import type { DocumentConverter } from "../application/organization";
import { ORGANIZATION_LIMITS } from "../../../../packages/navigation-core/contracts-organization";

/** The operator selects only the isolated local converter, never a user endpoint. */
export function validateDocumentConverterOrigin(value: string) {
  if (
    value !== "http://document-converter:8796" &&
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)
  )
    throw new Error("Invalid private document converter origin.");
  const url = new URL(value);
  if (Number(url.port) > 65535)
    throw new Error("Invalid private document converter port.");
  return url.origin;
}
export function createDocumentConverterAdapter(
  origin: string,
  transport: typeof fetch = fetch,
): DocumentConverter {
  const target = validateDocumentConverterOrigin(origin) + "/extract";
  return {
    async extract(input, context) {
      const failure = () =>
        new AuthorizationError(
          503,
          "UNAVAILABLE",
          "The document could not be extracted. Use a supported text-bearing document within the import limits.",
        );
      const http = createAdapterHttp(context, 30000, failure);
      try {
        const response = await http.within(() =>
          transport(target, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
            redirect: "error",
            signal: http.signal,
          }),
        );
        checkAdapterHttpResponse(response, failure);
        const output = z
          .object({
            text: z.string().min(1).max(ORGANIZATION_LIMITS.extractedBytes),
          })
          .strict()
          .parse(
            await http.json(
              response,
              ORGANIZATION_LIMITS.extractedBytes * 6 + 16,
            ),
          );
        if (Buffer.byteLength(output.text) > ORGANIZATION_LIMITS.extractedBytes)
          throw failure();
        return output.text;
      } catch {
        throw failure();
      } finally {
        http.close();
      }
    },
  };
}
