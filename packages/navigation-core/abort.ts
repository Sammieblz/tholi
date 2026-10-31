/** Bound a wait even when an operation ignores cancellation or rejects late. */
export function awaitAbortableOperation<T>(
  operation: () => Promise<T> | T,
  signal: AbortSignal,
  interrupted: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(interrupted());
      return;
    }
    let finished = false;
    const settle = (complete: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", aborted);
      complete();
    };
    const aborted = () => settle(() => reject(interrupted()));
    signal.addEventListener("abort", aborted, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw interrupted();
        return operation();
      })
      .then(
        (value) => (signal.aborted ? aborted() : settle(() => resolve(value))),
        (error: unknown) =>
          signal.aborted ? aborted() : settle(() => reject(error)),
      );
  });
}
