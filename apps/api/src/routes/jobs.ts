import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  cancelJobInputSchema,
  jobPageQuerySchema,
  jobPageSchema,
  jobSchema,
} from "../../../../packages/navigation-core/contracts-jobs";
import type { IdentityService } from "../application/identity";
import type { JobService } from "../application/jobs";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const jobParams = workspaceParams.extend({ jobId: z.string().uuid() });

export async function registerJobsApi(
  app: FastifyInstance,
  identity: IdentityService,
  jobs: JobService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const schema = (
    operationId: string,
    params: z.ZodTypeAny,
    response: z.ZodTypeAny,
    input: { query?: z.ZodTypeAny; body?: z.ZodTypeAny } = {},
  ) => ({
    ...identityRouteSchema(operationId, {
      ...input,
      response,
      protected: true,
      tags: ["jobs"],
    }),
    params: zodToJsonSchema(params, { target: "openApi3" }),
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/jobs",
    {
      schema: schema("listWorkspaceJobs", workspaceParams, jobPageSchema, {
        query: jobPageQuerySchema,
      }),
    },
    safe(async (request, _reply, context) =>
      jobs.list(
        (await authenticate(request)).session,
        workspaceParams.parse(request.params).workspaceId,
        request.query,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId",
    { schema: schema("getWorkspaceJob", jobParams, jobSchema) },
    safe(async (request, _reply, context) => {
      const { session } = await authenticate(request);
      const { workspaceId, jobId } = jobParams.parse(request.params);
      return jobs.get(session, workspaceId, jobId, context);
    }),
  );
  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/:jobId/cancel",
    {
      bodyLimit: 8192,
      schema: schema("cancelWorkspaceJob", jobParams, jobSchema, {
        body: cancelJobInputSchema,
      }),
    },
    safe(async (request, _reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      const { workspaceId, jobId } = jobParams.parse(request.params);
      return jobs.cancel(session, workspaceId, jobId, request.body, context);
    }),
  );
}
