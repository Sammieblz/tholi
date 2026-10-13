import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { boundedTransaction } from "../packages/site-memory/transaction";

test("a blocked memory write times out without replacing knowledge, then storage recovers", async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("blocked-memory-" + crypto.randomUUID(), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sites");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await boundedTransaction(db, "sites", "readwrite", (tx) =>
      tx.objectStore("sites").put("previous", "site"),
    );
    const blocker = db.transaction("sites", "readwrite");
    let hold = true;
    const pump = () => {
      const request = blocker.objectStore("sites").get("site");
      request.onsuccess = () => {
        if (hold) pump();
      };
    };
    pump();
    const released = new Promise<void>((resolve) => {
      blocker.oncomplete = () => resolve();
    });
    await expect(
      boundedTransaction(
        db,
        "sites",
        "readwrite",
        (tx) => tx.objectStore("sites").put("stalled replacement", "site"),
        25,
      ),
    ).rejects.toThrow("timed out");
    hold = false;
    await released;
    const read = () =>
      boundedTransaction<string>(db, "sites", "readonly", (tx, result) => {
        const request = tx.objectStore("sites").get("site");
        request.onsuccess = () => result(request.result);
      });
    expect(await read()).toBe("previous");
    await boundedTransaction(db, "sites", "readwrite", (tx) =>
      tx.objectStore("sites").put("fresh", "site"),
    );
    expect(await read()).toBe("fresh");
  } finally {
    db.close();
  }
});
