import type { DatabaseOptions } from "../database/postgres";
import { PostgresIdentityRepository } from "../database/identity";
import { PostgresRepositories } from "../database/repositories";
import type { IdentityOptions } from "../application/identity-contracts";
import { IdentityService } from "../application/identity";
import { AuthorizationService } from "../application/authorization";
import { createOidcProvider } from "./oidc";
import { createServiceDatabase } from "./service-database";
import { JobService } from "../application/jobs";

/** Composition only: HTTP replicas verify schema and never migrate or seed it. */
export async function createIdentityRuntime(
  identity: IdentityOptions,
  database: DatabaseOptions,
) {
  const { pool, resource } = await createServiceDatabase(database);
  try {
    const service = new IdentityService(
      identity,
      new PostgresIdentityRepository(pool),
      createOidcProvider(identity),
    );
    const repositories = new PostgresRepositories(pool);
    const authorization = new AuthorizationService(repositories);
    const jobs = new JobService(repositories);
    return { service, authorization, jobs, resource };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
