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

/** Composition only: HTTP replicas verify schema and never migrate or seed it. */
export async function createIdentityRuntime(
  identity: IdentityOptions,
  database: DatabaseOptions,
  supportOptions?: SupportRuntimeOptions,
) {
  const { pool, resource } = await createServiceDatabase(database);
  const resources: RuntimeResource[] = [resource];
  try {
    const service = new IdentityService(
      identity,
      new PostgresIdentityRepository(pool),
      createOidcProvider(identity),
    );
    const repositories = new PostgresRepositories(pool);
    const authorization = new AuthorizationService(repositories);
    const jobs = new JobService(repositories);
    let support: SupportService | undefined;
    if (supportOptions) {
      const objects = createS3Objects(
        supportOptions.objects,
        !identity.secureCookies,
      );
      resources.push({
        name: "private-storage",
        ready: () => objects.ready(),
        stop() {},
        close: () => objects.close(),
      });
      support = new SupportService(
        new PostgresSupport(pool),
        objects,
        createFileLinks(supportOptions.fileLinkSecret),
        supportOptions.options,
      );
    }
    return { service, authorization, jobs, support, resources, resource };
  } catch (error) {
    await Promise.allSettled(resources.map((item) => item.close()));
    throw error;
  }
}
