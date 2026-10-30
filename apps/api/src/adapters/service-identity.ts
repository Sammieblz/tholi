import type { DatabaseOptions } from "../database/postgres";
import { createDatabasePool } from "../database/postgres";
import { verifyDatabase } from "../database/migrations";
import { PostgresIdentityRepository } from "../database/identity";
import { PostgresRepositories } from "../database/repositories";
import type { RuntimeResource } from "../capabilities";
import type { IdentityOptions } from "../application/identity-contracts";
import { IdentityService } from "../application/identity";
import { AuthorizationService } from "../application/authorization";
import { createOidcProvider } from "./oidc";

/** Composition only: HTTP replicas verify schema and never migrate or seed it. */
export async function createIdentityRuntime(
  identity: IdentityOptions,
  database: DatabaseOptions,
) {
  const pool = createDatabasePool(database);
  const verify = async () => {
    const client = await pool.connect();
    try {
      await verifyDatabase(client);
    } finally {
      client.release();
    }
  };
  try {
    await verify();
    const service = new IdentityService(
      identity,
      new PostgresIdentityRepository(pool),
      createOidcProvider(identity),
    );
    const authorization = new AuthorizationService(
      new PostgresRepositories(pool),
    );
    const resource: RuntimeResource = {
      name: "identity-database",
      async ready() {
        try {
          await verify();
          return true;
        } catch {
          return false;
        }
      },
      stop() {},
      async close() {
        await pool.end();
      },
    };
    return { service, authorization, resource };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
