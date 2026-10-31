import type { DatabaseOptions } from "../database/postgres";
import { PostgresIdentityRepository } from "../database/identity";
import { PostgresRepositories } from "../database/repositories";
import type { IdentityOptions } from "../application/identity-contracts";
import { IdentityService } from "../application/identity";
import { AuthorizationService } from "../application/authorization";
import { createOidcProvider } from "./oidc";
import { createServiceDatabase } from "./service-database";
import { JobService } from "../application/jobs";
import type { SupportRuntimeOptions } from "../config";
import type { RuntimeResource } from "../capabilities";
import { PostgresSupport } from "../database/support";
import { SupportService } from "../application/support";
import { createS3Objects } from "./s3";
import { createFileLinks } from "./file-links";
import { ProductAnalyticsService } from "../application/analytics";
import type { Observability } from "../application/observability";
import { NavigationTransportService } from "../application/navigation";
import { createFakeNavigationModel } from "./fake-navigation-model";
import {
  CreditService,
  createNavigationQuotaPolicy,
} from "../application/quotas";
import { fakeDevelopmentChargingPolicy } from "../../../../packages/navigation-core/contracts-credits";
import { PlanService } from "../application/plans";
import { SavedDataService } from "../application/saved-data";

/** Composition only: HTTP replicas verify schema and never migrate or seed it. */
export async function createIdentityRuntime(
  identity: IdentityOptions,
  database: DatabaseOptions,
  supportOptions?: SupportRuntimeOptions,
  observer?: Observability,
  navigationEnabled = false,
  planEnvironment: "development" | "production" = "production",
) {
  const { pool, resource } = await createServiceDatabase(database, observer);
  const resources: RuntimeResource[] = [resource];
  try {
    const service = new IdentityService(
      identity,
      new PostgresIdentityRepository(pool),
      createOidcProvider(identity, undefined, observer),
    );
    const repositories = new PostgresRepositories(pool);
    const authorization = new AuthorizationService(repositories);
    const jobs = new JobService(repositories);
    const analytics = new ProductAnalyticsService(repositories);
    const plans = new PlanService(repositories, planEnvironment);
    const credits = new CreditService(
      repositories,
      fakeDevelopmentChargingPolicy,
    );
    const model = createFakeNavigationModel();
    const navigation = navigationEnabled
      ? new NavigationTransportService(
          repositories,
          model,
          createNavigationQuotaPolicy(
            repositories,
            model,
            fakeDevelopmentChargingPolicy,
            planEnvironment,
          ),
        )
      : undefined;
    let support: SupportService | undefined;
    let supportStore: PostgresSupport | undefined;
    if (supportOptions) {
      const objects = createS3Objects(
        supportOptions.objects,
        !identity.secureCookies,
        observer,
      );
      resources.push({
        name: "private-storage",
        ready: () => objects.ready(),
        stop() {},
        close: () => objects.close(),
      });
      supportStore = new PostgresSupport(pool);
      support = new SupportService(
        supportStore,
        objects,
        createFileLinks(supportOptions.fileLinkSecret),
        supportOptions.options,
      );
    }
    const savedData = new SavedDataService(
      repositories,
      supportStore,
      planEnvironment,
    );
    return {
      service,
      authorization,
      jobs,
      support,
      analytics,
      plans,
      savedData,
      credits,
      navigation,
      repositories,
      resources,
      resource,
    };
  } catch (error) {
    await Promise.allSettled(resources.map((item) => item.close()));
    throw error;
  }
}
