import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import {
  IndexedDBSiteMemory,
  mergeObservation,
} from "../../packages/site-memory";
import { IndexedDBDerivedStore } from "../../packages/site-memory/derived";
import { appFixture } from "./fixtures";
import { fixture } from "../nlp/fixtures";
import {
  beginJourney,
  saveTask,
} from "../../packages/goal-planner/task-journey";
test("v3 to v5 preserves public knowledge and routes while sanitizing private indexes", async () => {
  const publicPage = fixture(),
    privatePage = appFixture("github", "https://github.com");
  privatePage.controls[0].context = "secret-repo";
  privatePage.controls.push({
    ...privatePage.controls[0],
    id: "w1111111111111111-0",
    signature: "private",
    label: "secret-repo",
  });
  const publicSite = mergeObservation(undefined, publicPage),
    privateSite = mergeObservation(undefined, privatePage),
    publicTask = saveTask(beginJourney("Open Languages", publicPage.origin)),
    privateTask = saveTask(
      beginJourney("Open secret-repo", privatePage.origin),
    );
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open("navigator-site-memory", 3);
    r.onupgradeneeded = () => {
      for (const [name, key] of [
        ["sites", "origin"],
        ["tasks", "id"],
        ["indexes", "origin"],
        ["embeddings", "key"],
      ])
        r.result.createObjectStore(name, { keyPath: key });
    };
    r.onsuccess = () => {
      const db = r.result,
        tx = db.transaction(
          ["sites", "tasks", "indexes", "embeddings"],
          "readwrite",
        );
      tx.objectStore("sites").put(publicSite);
      tx.objectStore("sites").put(privateSite);
      tx.objectStore("tasks").put(publicTask);
      tx.objectStore("tasks").put(privateTask);
      tx.objectStore("indexes").put({
        origin: privatePage.origin,
        entries: [{ text: "secret-repo" }],
      });
      tx.objectStore("embeddings").put({
        key: "private",
        revision: "old",
        vector: [1],
        usedAt: 1,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    r.onerror = () => reject(r.error);
  });
  const memory = new IndexedDBSiteMemory(),
    derived = new IndexedDBDerivedStore();
  expect(await memory.get(publicPage.origin)).toEqual(publicSite);
  expect(await memory.tasks(publicPage.origin)).toEqual([publicTask]);
  expect(JSON.stringify(await memory.get(privatePage.origin))).not.toContain(
    "secret-repo",
  );
  expect(JSON.stringify(await memory.tasks(privatePage.origin))).not.toContain(
    "secret-repo",
  );
  expect(await derived.getEmbedding("private")).toBeUndefined();
  await memory.forget(privatePage.origin);
  expect(await memory.get(privatePage.origin)).toBeUndefined();
  expect(await memory.get(publicPage.origin)).toEqual(publicSite);
});
