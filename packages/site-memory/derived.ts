import type {
  DerivedStore,
  CachedEmbedding,
  IndexEntry,
} from "../nlp/retrieval";
import { MODEL_REVISION } from "../nlp/constants";
export class IndexedDBDerivedStore implements DerivedStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    return (this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("navigator-site-memory", 3);
      request.onupgradeneeded = () => {
        for (const [name, key] of [
          ["sites", "origin"],
          ["tasks", "id"],
          ["embeddings", "key"],
          ["indexes", "origin"],
        ])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: key });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        const tx = db.transaction(["embeddings", "indexes"], "readwrite");
        const entries = tx.objectStore("embeddings").openCursor();
        entries.onsuccess = () => {
          const cursor = entries.result;
          if (cursor) {
            if (cursor.value.revision !== MODEL_REVISION) cursor.delete();
            cursor.continue();
          }
        };
        const indexes = tx.objectStore("indexes").openCursor();
        indexes.onsuccess = () => {
          const cursor = indexes.result;
          if (cursor) {
            if (cursor.value.revision !== MODEL_REVISION) cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(db);
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onblocked = () =>
        reject(
          new Error(
            "Close the old extension pages to finish the memory upgrade.",
          ),
        );
    }));
  }
  private async transaction<T>(
    names: string[],
    action: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, "readwrite");
      let value: T;
      action(tx, (v) => {
        value = v;
      });
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  getEmbedding(key: string) {
    return this.transaction<CachedEmbedding | undefined>(
      ["embeddings"],
      (tx, result) => {
        const r = tx.objectStore("embeddings").get(key);
        r.onsuccess = () => result(r.result);
      },
    );
  }
  async putEmbedding(value: CachedEmbedding) {
    await this.transaction<void>(["embeddings"], (tx) => {
      const store = tx.objectStore("embeddings");
      store.put(value);
      const count = store.count();
      count.onsuccess = () => {
        if (count.result <= 10000) return;
        const all = store.getAll();
        all.onsuccess = () => {
          for (const old of (all.result as CachedEmbedding[])
            .sort((a, b) => b.usedAt - a.usedAt)
            .slice(10000))
            store.delete(old.key);
        };
      };
    });
  }
  async putIndex(origin: string, entries: IndexEntry[]) {
    await this.transaction<void>(["indexes"], (tx) => {
      const store = tx.objectStore("indexes"),
        old = store.get(origin);
      old.onsuccess = () => {
        const merged = new Map<string, IndexEntry>(
          (old.result?.entries || []).map((e: IndexEntry) => [e.signature, e]),
        );
        for (const entry of entries) {
          merged.delete(entry.signature);
          merged.set(entry.signature, entry);
        }
        store.put({
          origin,
          entries: [...merged.values()].slice(-5000),
          revision: MODEL_REVISION,
          updatedAt: Date.now(),
        });
      };
    });
  }
  async clearDerived(origin?: string) {
    await this.transaction<void>(["indexes", "embeddings"], (tx) => {
      const indexes = tx.objectStore("indexes");
      origin ? indexes.delete(origin) : indexes.clear(); // Shared content hashes cannot leak forgotten site semantics via the cache.
      tx.objectStore("embeddings").clear();
    });
  }
}
