import { createDatabasePool, type DatabaseOptions } from "../database/postgres";
import { verifyDatabase } from "../database/migrations";
import type { RuntimeResource } from "../capabilities";
import type { Observability } from "../application/observability";

/** Shared schema verification and lifetime; replicas never migrate or seed. */
export async function createServiceDatabase(
  database: DatabaseOptions,
  observer?: Observability,
) {
  const pool = createDatabasePool(database, observer);
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
  } catch (error) {
    await pool.end();
    throw error;
  }
  const resource: RuntimeResource = {
    name: "service-database",
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
  return { pool, resource };
}
