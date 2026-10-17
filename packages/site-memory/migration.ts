import { savedTaskSchema } from "../page-model";
import {
  privatePlatform,
  structuralKnowledge,
  parameterizedTask,
} from "../navigation-core/privacy";
/** Preserve the existing legacy action/default policy in both storage adapters. */
export function upgradeTransition<
  T extends { signature: string; action?: unknown },
>(edge: T) {
  return {
    ...edge,
    action: edge.action || { kind: "control", signature: edge.signature },
    requiresFreshBinding: true,
  };
}

export function upgradePrivateMemory(tx: IDBTransaction) {
  upgradeRouteActions(tx, true);
  const tasks = tx.objectStore("tasks").openCursor();
  tasks.onsuccess = () => {
    const row = tasks.result;
    if (!row) return;
    const parsed = savedTaskSchema.safeParse(row.value);
    if (parsed.success) row.update(parameterizedTask(parsed.data));
    row.continue();
  };
  // Legacy vectors lack trustworthy origin provenance; only derived vectors are
  // cleared. Original public sites and parameterized route structure survive.
  tx.objectStore("embeddings").clear();
}

export function upgradeRouteActions(
  tx: IDBTransaction,
  sanitizeLegacy = false,
) {
  const request = tx.objectStore("sites").openCursor();
  request.onsuccess = () => {
    const row = request.result;
    if (!row) return;
    const value =
      sanitizeLegacy && privatePlatform(row.value.origin)
        ? structuralKnowledge(row.value)
        : row.value;
    if (sanitizeLegacy && privatePlatform(row.value.origin))
      tx.objectStore("indexes").delete(row.value.origin);
    row.update({
      ...value,
      transitions: (value.transitions || []).map(upgradeTransition),
    });
    row.continue();
  };
}
