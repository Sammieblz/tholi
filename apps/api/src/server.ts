import cors from "@fastify/cors";
import { ApiError, createHttpApi, registerHealth } from "./http";
import {
  validateApiOptions,
  validateServiceOptions,
  type ApiOptions,
  type ServiceApiOptions,
} from "./config";
import type { PrivateCapabilities, RuntimeResource } from "./capabilities";

export type { ApiOptions, ServiceApiOptions } from "./config";

/** Compatible facade for the existing single-owner API. */
export async function createApi(
  input: ApiOptions,
  injected?: PrivateCapabilities,
) {
  const options = validateApiOptions(input);
  const capabilities =
    injected ??
    (await (
      await import("./adapters/private")
    ).createPrivateCapabilities(options));
  return createHttpApi(
    "legacy-private",
    capabilities.resources,
    async (app, lifecycle) => {
      const { registerPrivateApi } = await import("./routes/private");
      await registerPrivateApi(app, options, capabilities, lifecycle);
    },
  );
}

/** Explicit service profile; private bearers never grant service access. */
export async function createServiceApi(
  input: ServiceApiOptions,
  resources: RuntimeResource[] = [],
) {
  const options = validateServiceOptions(input);
  return createHttpApi("service", resources, async (app, lifecycle) => {
    await app.register(cors, {
      origin: (origin, callback) =>
        callback(null, !origin || options.origins.includes(origin)),
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "X-Tholi-Timeout-Ms"],
      exposedHeaders: ["X-Request-Id"],
      strictPreflight: true,
    });
    app.addHook("onRequest", async (request) => {
      if (
        request.headers.origin &&
        !options.origins.includes(request.headers.origin)
      )
        throw new ApiError(403, "FORBIDDEN", "Origin is not allowed.");
    });
    const { registerServiceApi } = await import("./routes/service");
    await registerServiceApi(app);
    registerHealth(app, "service", lifecycle);
  });
}
