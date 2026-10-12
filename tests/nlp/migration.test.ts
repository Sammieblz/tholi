import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import {
  IndexedDBSiteMemory,
  mergeObservation,
} from "../../packages/site-memory";
import { IndexedDBDerivedStore } from "../../packages/site-memory/derived";
import { MemoryDerivedStore } from "../../packages/nlp/retrieval";
import {
  beginJourney,
  saveTask,
} from "../../packages/goal-planner/task-journey";
import { fixture } from "./fixtures";
test("v2 to v3 adds derived stores without discarding sites or saved routes", async () => {
  const page = fixture(),
    site = mergeObservation(undefined, page),
    task = saveTask(beginJourney("Open Languages", page.origin));
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open("navigator-site-memory", 2);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("sites", { keyPath: "origin" });
      r.result.createObjectStore("tasks", { keyPath: "id" });
    };
    r.onsuccess = () => {
      const db = r.result,
        tx = db.transaction(["sites", "tasks"], "readwrite");
      tx.objectStore("sites").put(site);
      tx.objectStore("tasks").put(task);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const memory = new IndexedDBSiteMemory();
  expect(await memory.get(page.origin)).toEqual(site);
  expect(await memory.tasks(page.origin)).toEqual([task]);
  const derived = new IndexedDBDerivedStore();
  await derived.putEmbedding({
    key: "old",
    revision: "old-model",
    vector: [1],
    usedAt: 1,
  });
  await derived.putIndex(page.origin, []);
  expect(await memory.get(page.origin)).toEqual(site);
  await derived.clearDerived(page.origin);
  expect(await derived.getEmbedding("old")).toBeUndefined();
  expect(await memory.tasks(page.origin)).toEqual([task]);
});
test("global embedding cache evicts past 10,000 entries", async () => {
  const store = new MemoryDerivedStore();
  for (let i = 0; i <= 10000; i++)
    await store.putEmbedding({
      key: String(i),
      revision: "model",
      vector: [i],
      usedAt: i,
    });
  expect(store.embeddings.size).toBe(10000);
  expect(await store.getEmbedding("0")).toBeUndefined();
  expect((await store.getEmbedding("10000"))?.vector).toEqual([10000]);
});
