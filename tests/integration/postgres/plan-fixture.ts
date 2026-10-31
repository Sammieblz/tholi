import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import {
  productCatalogSchema,
  type PlanCaps,
} from "../../../packages/navigation-core/contracts-plans";

/** Migrator-only immutable catalog publication shared by plan and saved-data checks. */
export async function planFixture(runtime: Pool, migration: Pool) {
  const catalog = productCatalogSchema.parse(
    await new PostgresRepositories(runtime).readPlanCatalog(),
  );
  const free = catalog.plans.find((plan) => plan.mode === "free-cloud");
  assert.ok(free?.developmentAllowance);
  const allowance = free.developmentAllowance;
  let nextVersion = Number(
    (
      await migration.query(
        "SELECT max(version) AS version FROM tholi.plan_versions WHERE plan_id=$1",
        [free.id],
      )
    ).rows[0].version,
  );
  const selectFree = async (
    caps: Partial<PlanCaps> = {},
    programId = allowance.programId,
  ) => {
    const catalogVersion = `pg-catalog-${randomUUID()}`;
    const selected = {
      ...free,
      version: ++nextVersion,
      developmentAllowance: {
        ...allowance,
        programId,
        caps: { ...allowance.caps, ...caps },
      },
    };
    productCatalogSchema.parse({
      ...catalog,
      catalogVersion,
      plans: catalog.plans.map((plan) =>
        plan.id === free.id ? selected : plan,
      ),
    });
    await migration.query(
      "INSERT INTO tholi.plan_versions(plan_id,version,name,definition) VALUES($1,$2,$3,$4::jsonb)",
      [selected.id, selected.version, selected.name, JSON.stringify(selected)],
    );
    await migration.query(
      "INSERT INTO tholi.product_catalog_releases(version,charging_policy_version) VALUES($1,$2)",
      [catalogVersion, catalog.chargingPolicyVersion],
    );
    await migration.query(
      `INSERT INTO tholi.product_catalog_entries(catalog_version,plan_id,plan_version,position)
      SELECT $1,plan_id,CASE WHEN plan_id=$2 THEN $3 ELSE plan_version END,position
      FROM tholi.product_catalog_entries WHERE catalog_version=$4`,
      [catalogVersion, selected.id, selected.version, catalog.catalogVersion],
    );
    await migration.query(
      "UPDATE tholi.product_catalog_control SET current_version=$1 WHERE singleton",
      [catalogVersion],
    );
    return selected;
  };
  const restore = () =>
    migration.query(
      "UPDATE tholi.product_catalog_control SET current_version=$1 WHERE singleton",
      [catalog.catalogVersion],
    );
  return { catalog, free, allowance, selectFree, restore };
}
