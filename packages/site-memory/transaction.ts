/** A stalled durable write must not hold the live navigation command queue. */
export function boundedTransaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction, result: (value: T) => void) => void,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let value: T;
    const deadline = setTimeout(() => {
      try {
        transaction.abort();
      } catch {}
      reject(new Error("Site memory transaction timed out."));
    }, timeoutMs);
    transaction.oncomplete = () => {
      clearTimeout(deadline);
      resolve(value);
    };
    transaction.onerror = transaction.onabort = () => {
      clearTimeout(deadline);
      reject(
        transaction.error || new Error("Site memory transaction aborted."),
      );
    };
    try {
      action(transaction, (result) => {
        value = result;
      });
    } catch (error) {
      clearTimeout(deadline);
      try {
        transaction.abort();
      } catch {}
      reject(error);
    }
  });
}
