import cors from "@fastify/cors";
import { ApiError, createHttpApi, registerHealth } from "./http";
import {
  validateApiOptions,
  validateServiceOptions,
  type ApiOptions,
  type ServiceApiOptions,
} from "./config";
import type { PrivateCapabilities, RuntimeResource } from "./capabilities";
import type { IdentityService } from "./application/identity";
import type { AuthorizationService } from "./application/authorization";

export type { ApiOptions, ServiceApiOptions } from "./config";

/** Explicit composition seam for real services and isolated transport tests. */
export interface ServiceApiServices {
  identity?: IdentityService;
  authorization?: AuthorizationService;
}

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
  injected: ServiceApiServices = {},
) {
  const options = validateServiceOptions(input);
  let identity = injected.identity;
  let authorization = injected.authorization;
  const ownedResources = [...resources];
  if (authorization && !identity)
    throw new Error("Authorization requires the composed identity service.");
  if (identity && !options.identity)
    throw new Error(
      "Identity injection requires an explicit identity profile.",
    );
  if (options.identity && !identity) {
    const { createIdentityRuntime } =
      await import("./adapters/service-identity");
    const runtime = await createIdentityRuntime(
      options.identity,
      options.database!,
    );
    identity = runtime.service;
    authorization = runtime.authorization;
    ownedResources.push(runtime.resource);
  }
  // Extension origins are transport admission, never account identity. Firefox's
  // per-profile origin is not its stable registered OAuth callback.
  const nativeOrigin = (origin: string) => {
    if (!options.identity) return false;
    const chromium = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (chromium)
      return options.identity.clients.some(
        (client) =>
          client.kind === "extension" &&
          client.redirectUris.some(
            (redirect) =>
              new URL(redirect).hostname === `${chromium[1]}.chromiumapp.org`,
          ),
      );
    return (
      /^moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        origin,
      ) &&
      options.identity.clients.some(
        (client) =>
          client.kind === "extension" &&
          client.redirectUris.some((redirect) =>
            new URL(redirect).hostname.endsWith(".extensions.allizom.org"),
          ),
      )
    );
  };
  const allowed = (origin: string | undefined) =>
    !origin || options.origins.includes(origin) || nativeOrigin(origin);
  return createHttpApi("service", ownedResources, async (app, lifecycle) => {
    await app.register(cors, {
      delegator: (request, callback) =>
        callback(null, {
          origin:
            request.headers.origin && allowed(request.headers.origin)
              ? request.headers.origin
              : false,
          credentials:
            !!identity &&
            request.headers.origin === options.identity?.webOrigin,
          methods: identity
            ? ["GET", "POST", ...(authorization ? ["PATCH"] : []), "DELETE"]
            : ["GET", "POST"],
          allowedHeaders: identity
            ? [
                "Content-Type",
                "X-Tholi-Timeout-Ms",
                "Authorization",
                "X-Tholi-CSRF",
              ]
            : ["Content-Type", "X-Tholi-Timeout-Ms"],
          exposedHeaders: ["X-Request-Id"],
          strictPreflight: true,
        }),
    });
    app.addHook("onRequest", async (request) => {
      if (!allowed(request.headers.origin))
        throw new ApiError(403, "FORBIDDEN", "Origin is not allowed.");
    });
    const { registerServiceApi } = await import("./routes/service");
    await registerServiceApi(
      app,
      !!identity,
      options.identity?.secureCookies,
      !!authorization,
    );
    if (identity) {
      const { registerIdentityApi } = await import("./routes/identity");
      await registerIdentityApi(app, identity);
      if (authorization) {
        const { registerAuthorizationApi } =
          await import("./routes/authorization");
        await registerAuthorizationApi(app, identity, authorization);
      }
    }
    registerHealth(app, "service", lifecycle);
  });
}
