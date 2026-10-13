import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { IndexedDBDerivedStore } from "../packages/site-memory/derived";
import { MODEL_REVISION } from "../packages/nlp/constants";

test("a blocked embedding cache falls back promptly, writes asynchronously, and drains before Clear", async () => {
  const store = new IndexedDBDerivedStore();
  await store.getEmbedding("initialize");
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = indexedDB.open("navigator-site-memory", 5);
    r.onsuccess = () => resolve(r.result);
  });
  const blocker = db.transaction(["embeddings", "indexes"], "readwrite");
  let hold = true;
  const released = new Promise<void>((resolve) => {
    blocker.oncomplete = () => resolve();
  });
  const pump = () => {
    const r = blocker.objectStore("embeddings").get("initialize");
    r.onsuccess = () => {
      if (hold) pump();
    };
  };
  pump();
  try {
    const before = performance.now();
    expect(await store.getEmbedding("missing")).toBeUndefined();
    expect(performance.now() - before).toBeLessThan(1000);
    await store.putEmbedding({
      key: "fresh",
      revision: MODEL_REVISION,
      vector: Array(384).fill(0),
      usedAt: Date.now(),
    });
    await store.putIndex("https://example.test", [
      { signature: "control", hash: "hash", text: "Settings" },
    ]);
    hold = false;
    await released;
    const counts = () =>
      Promise.all(
        ["embeddings", "indexes"].map(
          (name) =>
            new Promise<number>((resolve) => {
              const r = db.transaction(name).objectStore(name).count();
              r.onsuccess = () => resolve(r.result);
            }),
        ),
      );
    await expect.poll(counts).toEqual([1, 1]);
    await store.clearDerived();
    expect(await counts()).toEqual([0, 0]);
  } finally {
    hold = false;
    await released;
    db.close();
  }
});
