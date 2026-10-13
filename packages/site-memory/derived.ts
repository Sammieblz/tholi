import type {
  DerivedStore,
  CachedEmbedding,
  IndexEntry,
} from "../nlp/retrieval";
import { MODEL_REVISION } from "../nlp/constants";
import { upgradePrivateMemory, upgradeRouteActions } from "./migration";
import { boundedTransaction } from "./transaction";
import { BackgroundMemory } from "./background";
export class IndexedDBDerivedStore implements DerivedStore {
  private database?: Promise<IDBDatabase>;
  private jobs = new BackgroundMemory();
  private unavailableUntil = 0;
  private open() {
    return (this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("navigator-site-memory", 5);
      request.onupgradeneeded = (event) => {
        for (const [name, key] of [
          ["sites", "origin"],
          ["tasks", "id"],
          ["embeddings", "key"],
          ["indexes", "origin"],
        ])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: key });
        if (event.oldVersion < 4) upgradePrivateMemory(request.transaction!);
        else upgradeRouteActions(request.transaction!);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        void boundedTransaction<void>(
          db,
          ["embeddings", "indexes"],
          "readwrite",
          (tx) => {
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
          },
        ).then(
          () => resolve(db),
          (error) => {
            db.close();
            this.database = undefined;
            reject(error);
          },
        );
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
    mode: IDBTransactionMode = "readwrite",
    timeoutMs = 5000,
  ): Promise<T> {
    const db = await this.open();
    return boundedTransaction<T>(db, names, mode, action, timeoutMs);
  }
  async getEmbedding(key: string) {
    if (Date.now() < this.unavailableUntil) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.transaction<CachedEmbedding | undefined>(
          ["embeddings"],
          (tx, result) => {
            const r = tx.objectStore("embeddings").get(key);
            r.onsuccess = () => result(r.result);
          },
          "readonly",
          200,
        ),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            this.unavailableUntil = Date.now() + 5000;
            resolve(undefined);
          }, 200);
        }),
      ]);
    } catch {
      this.unavailableUntil = Date.now() + 5000;
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  async putEmbedding(value: CachedEmbedding) {
    this.jobs.schedule("embedding:" + value.key, () =>
      this.transaction<void>(["embeddings"], (tx) => {
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
      }),
    );
  }
  async putIndex(origin: string, entries: IndexEntry[]) {
    this.jobs.schedule("index:" + origin, () =>
      this.transaction<void>(["indexes"], (tx) => {
        const store = tx.objectStore("indexes"),
          old = store.get(origin);
        old.onsuccess = () => {
          const merged = new Map<string, IndexEntry>(
            (old.result?.entries || []).map((e: IndexEntry) => [
              e.signature,
              e,
            ]),
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
      }),
    );
  }
  async clearDerived(origin?: string) {
    await this.jobs.cancelAndDrain();
    await this.transaction<void>(["indexes", "embeddings"], (tx) => {
      const indexes = tx.objectStore("indexes");
      origin ? indexes.delete(origin) : indexes.clear(); // Shared content hashes cannot leak forgotten site semantics via the cache.
      tx.objectStore("embeddings").clear();
    });
  }
}
