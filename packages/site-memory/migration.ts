import { savedTaskSchema } from "../page-model";
import {
  privatePlatform,
  structuralKnowledge,
  parameterizedTask,
} from "../navigation-core/privacy";
export function upgradePrivateMemory(tx: IDBTransaction) {
  const sites = tx.objectStore("sites").openCursor();
  sites.onsuccess = () => {
    const row = sites.result;
    if (!row) return;
    if (privatePlatform(row.value.origin)) {
      row.update(structuralKnowledge(row.value));
      tx.objectStore("indexes").delete(row.value.origin);
    }
    row.continue();
  };
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
