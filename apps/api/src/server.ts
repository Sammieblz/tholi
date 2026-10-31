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
import type { JobService } from "./application/jobs";
import type { SupportService } from "./application/support";
import type { ProductAnalyticsService } from "./application/analytics";
import type { Observability } from "./application/observability";
import type { NavigationTransportService } from "./application/navigation";
import type { CreditService } from "./application/quotas";
import type { PlanService } from "./application/plans";
import { createObservability } from "./adapters/observability";

export type { ApiOptions, ServiceApiOptions } from "./config";

/** Explicit composition seam for real services and isolated transport tests. */
export interface ServiceApiServices {
  identity?: IdentityService;
  authorization?: AuthorizationService;
  jobs?: JobService;
  support?: SupportService;
  analytics?: ProductAnalyticsService;
  observability?: Observability;
  navigation?: NavigationTransportService;
  credits?: CreditService;
  plans?: PlanService;
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
  return createServiceRuntime(input, resources, injected, false);
}

/** Operator entrypoint only; ordinary environment startup cannot select this. */
export async function createOperatorEvaluationApi(
  input: ServiceApiOptions,
  resources: RuntimeResource[],
  injected: ServiceApiServices,
) {
  if (
    injected.navigation?.provider !== "operator-evaluation" ||
    !injected.navigation.evaluationMetadata ||
    !injected.identity ||
    !injected.authorization
  )
    throw new Error(
      "Operator evaluation requires its admitted authenticated composition.",
    );
  return createServiceRuntime(input, resources, injected, true);
}

async function createServiceRuntime(
  input: ServiceApiOptions,
  resources: RuntimeResource[],
  injected: ServiceApiServices,
  operatorEvaluation: boolean,
) {
  const options = validateServiceOptions(input);
  let identity = injected.identity;
  let authorization = injected.authorization;
  let jobs = injected.jobs;
  let support = injected.support;
  let analytics = injected.analytics;
  let navigation = injected.navigation;
  let credits = injected.credits;
  let plans = injected.plans;
  const ownedResources = [...resources];
  if (
    (authorization ||
      jobs ||
      support ||
      analytics ||
      navigation ||
      credits ||
      plans) &&
    !identity
  )
    throw new Error("Authorization requires the composed identity service.");
  if (identity && !options.identity)
    throw new Error(
      "Identity injection requires an explicit identity profile.",
    );
  if (navigation?.provider === "operator-evaluation" && !operatorEvaluation)
    throw new Error("Operator evaluation cannot use ordinary service startup.");
  if (navigation && !options.navigation && !operatorEvaluation)
    throw new Error(
      "Navigation injection requires the explicit fake transport profile.",
    );
  if (navigation && !authorization)
    throw new Error(
      "Navigation transport requires composed tenant authorization.",
    );
  const observer =
    injected.observability ?? createObservability(options.observability);
  if (options.identity && !identity) {
    const { createIdentityRuntime } =
      await import("./adapters/service-identity");
    const runtime = await createIdentityRuntime(
      options.identity,
      options.database!,
      options.support,
      observer,
      !!options.navigation,
      options.plans?.environment,
    ).catch(async (error) => {
      await observer.close();
      throw error;
    });
    identity = runtime.service;
    authorization = runtime.authorization;
    jobs = runtime.jobs;
    support = runtime.support;
    analytics = runtime.analytics;
    navigation = runtime.navigation;
    credits = runtime.credits;
    plans = runtime.plans;
    ownedResources.push(...runtime.resources);
  }
  // Accept late completions during drain, then flush after application resources close.
  if (observer.enabled) ownedResources.push(observer);
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
  return createHttpApi(
    "service",
    ownedResources,
    async (app, lifecycle) => {
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
        !!jobs,
        !!support,
        !!analytics,
        !!navigation,
        navigation?.evaluationMetadata,
        !!credits,
        !!plans,
      );
      if (identity) {
        const { registerIdentityApi } = await import("./routes/identity");
        await registerIdentityApi(app, identity);
        if (authorization) {
          const { registerAuthorizationApi } =
            await import("./routes/authorization");
          await registerAuthorizationApi(app, identity, authorization);
        }
        if (jobs) {
          const { registerJobsApi } = await import("./routes/jobs");
          await registerJobsApi(app, identity, jobs);
        }
        if (analytics) {
          const { registerAnalyticsApi } = await import("./routes/analytics");
          await registerAnalyticsApi(app, identity, analytics);
        }
        if (support) {
          const { registerSupportApi } = await import("./routes/support");
          const { registerFilesApi } = await import("./routes/files");
          await registerSupportApi(app, identity, support);
          await registerFilesApi(app, identity, support);
        }
        if (navigation) {
          const { registerNavigationApi } = await import("./routes/navigation");
          await registerNavigationApi(app, identity, navigation);
        }
        if (credits) {
          const { registerCreditsApi } = await import("./routes/credits");
          await registerCreditsApi(app, identity, credits);
        }
        if (plans) {
          const { registerPlansApi } = await import("./routes/plans");
          await registerPlansApi(app, identity, plans);
        }
      }
      registerHealth(app, "service", lifecycle);
    },
    options.transport,
    observer,
  );
}
