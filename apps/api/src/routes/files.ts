import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  fileDownloadQuerySchema,
  fileLinkInputSchema,
  fileLinkSchema,
  privateFileSchema,
} from "../../../../packages/navigation-core/contracts-support";
import { IdentityError, type IdentityService } from "../application/identity";
import type { SupportService } from "../application/support";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const fileParams = z.object({ fileId: z.string().uuid() }).strict();
const params = zodToJsonSchema(fileParams, { target: "openApi3" });

/** Link tokens never replace current account authentication and scoped file checks. */
export async function registerFilesApi(
  app: FastifyInstance,
  identity: IdentityService,
  support: SupportService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  app.get(
    "/api/v1/account/files/:fileId",
    {
      schema: {
        ...identityRouteSchema("getAccountPrivateFile", {
          response: privateFileSchema,
          protected: true,
          tags: ["files"],
        }),
        params,
      },
    },
    safe(async (request, _reply, context) =>
      support.getFile(
        (await authenticate(request)).session,
        fileParams.parse(request.params).fileId,
        context,
      ),
    ),
  );
  app.post(
    "/api/v1/account/files/:fileId/link",
    {
      bodyLimit: 8192,
      schema: {
        ...identityRouteSchema("createAccountPrivateFileLink", {
          body: fileLinkInputSchema,
          response: fileLinkSchema,
          protected: true,
          tags: ["files"],
        }),
        params,
      },
    },
    safe(async (request, _reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      return support.fileLink(
        session,
        fileParams.parse(request.params).fileId,
        request.body,
        context,
      );
    }),
  );
  app.get(
    "/api/v1/account/files/:fileId/download",
    {
      schema: {
        ...identityRouteSchema("downloadAccountPrivateFile", {
          query: fileDownloadQuerySchema,
          protected: true,
          tags: ["files"],
        }),
        params,
      },
    },
    safe(async (request, reply, context) => {
      const { session } = await authenticate(request);
      const { token } = fileDownloadQuerySchema.parse(request.query);
      const file = await support.download(
        session,
        fileParams.parse(request.params).fileId,
        token,
        context,
      );
      const current = (await authenticate(request)).session;
      if (
        current.id !== session.id ||
        current.accountId !== session.accountId ||
        current.workspaceId !== session.workspaceId
      )
        throw new IdentityError(
          401,
          "UNAUTHENTICATED",
          "Sign in again to continue.",
        );
      return reply
        .header("Content-Type", file.contentType)
        .header(
          "Content-Disposition",
          'attachment; filename="tholi-diagnostic.json"',
        )
        .header("X-Content-Type-Options", "nosniff")
        .send(Buffer.from(file.body));
    }),
  );
}
