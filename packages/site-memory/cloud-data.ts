import {
  emptySavedDataClientState,
  savedDataClientStateSchema,
  savedDataClientStateV2Schema,
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
              if (request.result === undefined && scope.schemaVersion === 2) {
                const legacy = transaction.objectStore("accounts").get(
                  savedDataConnectionKey({
                    ...scope,
                    schemaVersion: undefined,
                  }),
                );
                legacy.onsuccess = () => {
                  try {
                    current();
                    result(
                      legacy.result === undefined
                        ? emptySavedDataClientState(2)
                        : savedDataClientStateV2Schema.parse({
                            ...savedDataClientStateSchema.parse(legacy.result),
                            version: 2,
                            after: "0",
                          }),
                    );
                  } catch (error) {
                    failure = error;
                    transaction.abort();
                  }
                };
              } else
                result(
                  request.result === undefined
                    ? emptySavedDataClientState(scope.schemaVersion ?? 1)
                    : (scope.schemaVersion === 2
                        ? savedDataClientStateV2Schema
                        : savedDataClientStateSchema
                      ).parse(request.result),
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
              const apply = (value: unknown, legacy = false) => {
                current();
                const previous =
                  value === undefined
                    ? emptySavedDataClientState(scope.schemaVersion ?? 1)
                    : legacy
                      ? savedDataClientStateV2Schema.parse({
                          ...savedDataClientStateSchema.parse(value),
                          version: 2,
                          after: "0",
                        })
                      : (scope.schemaVersion === 2
                          ? savedDataClientStateV2Schema
                          : savedDataClientStateSchema
                        ).parse(value);
                const next = (
                  scope.schemaVersion === 2
                    ? savedDataClientStateV2Schema
                    : savedDataClientStateSchema
                ).parse(change(previous));
                current();
                store.put(next, key);
                result(next);
              };
              if (request.result === undefined && scope.schemaVersion === 2) {
                const legacy = store.get(
                  savedDataConnectionKey({
                    ...scope,
                    schemaVersion: undefined,
                  }),
                );
                legacy.onsuccess = () => {
                  try {
                    apply(legacy.result, true);
                  } catch (error) {
                    failure = error;
                    transaction.abort();
                  }
                };
              } else apply(request.result);
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
        const store = transaction.objectStore("accounts");
        store.delete(
          savedDataConnectionKey({ ...scope, schemaVersion: undefined }),
        );
        store.delete(savedDataConnectionKey({ ...scope, schemaVersion: 2 }));
      },
    );
  }
}
