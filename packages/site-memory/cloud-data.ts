import {
  emptySavedDataClientState,
  savedDataClientStateSchema,
  savedDataConnectionKey,
  type SavedDataClientState,
  type SavedDataClientStore,
  type SavedDataConnection,
} from "../navigation-core/saved-data-client";
import { boundedTransaction } from "./transaction";

/** Account caches are separate from locally owned website knowledge and saved routes. */
export class IndexedDBCloudDataStore implements SavedDataClientStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tholi-cloud-data", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("accounts");
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.database = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(new Error("Private cloud storage is unavailable."));
      };
      request.onblocked = () => {
        this.database = undefined;
        reject(
          new Error(
            "Close older Tholi account views before reopening cloud data.",
          ),
        );
      };
    }));
  }
  async read(scope: SavedDataConnection, current: () => void) {
    const database = await this.open();
    let failure: unknown;
    try {
      return await boundedTransaction<SavedDataClientState>(
        database,
        "accounts",
        "readonly",
        (transaction, result) => {
          const request = transaction
            .objectStore("accounts")
            .get(savedDataConnectionKey(scope));
          request.onsuccess = () => {
            try {
              current();
              result(
                request.result === undefined
                  ? emptySavedDataClientState()
                  : savedDataClientStateSchema.parse(request.result),
              );
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
        },
      );
    } catch (error) {
      throw failure ?? error;
    }
  }
  async update(
    scope: SavedDataConnection,
    change: (state: SavedDataClientState) => SavedDataClientState,
    current: () => void,
  ) {
    const database = await this.open(),
      key = savedDataConnectionKey(scope);
    let failure: unknown;
    try {
      return await boundedTransaction<SavedDataClientState>(
        database,
        "accounts",
        "readwrite",
        (transaction, result) => {
          const store = transaction.objectStore("accounts"),
            request = store.get(key);
          request.onsuccess = () => {
            try {
              current();
              const previous =
                request.result === undefined
                  ? emptySavedDataClientState()
                  : savedDataClientStateSchema.parse(request.result);
              const next = savedDataClientStateSchema.parse(change(previous));
              current();
              store.put(next, key);
              result(next);
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
        },
      );
    } catch (error) {
      throw failure ?? error;
    }
  }
  async clear(scope: SavedDataConnection) {
    const database = await this.open();
    await boundedTransaction<void>(
      database,
      "accounts",
      "readwrite",
      (transaction) => {
        transaction
          .objectStore("accounts")
          .delete(savedDataConnectionKey(scope));
      },
    );
  }
}
