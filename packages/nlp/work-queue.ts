type Job<T, R> = {
  id: string;
  key: string;
  priority: number;
  input: T;
  controller: AbortController;
  resolve: (value: R) => void;
  reject: (error: Error) => void;
};
/** User destinations/decisions outrank automatic continuation and suggestions. */
export function inferencePriority(
  input: { request?: unknown; choice?: unknown },
  suggestions: boolean,
) {
  return suggestions ? 2 : input.request && !input.choice ? 1 : 0;
}
/** Bounded, latest-per-context inference. CPU model calls never overlap. */
export class InferenceQueue<T, R> {
  private pending: Job<T, R>[] = [];
  private active?: Job<T, R>;
  constructor(
    private run: (input: T, signal: AbortSignal) => Promise<R>,
    private capacity = 8,
  ) {}
  submit(id: string, key: string, priority: number, input: T): Promise<R> {
    return new Promise((resolve, reject) => {
      if (
        (this.active?.key === key && this.active.priority < priority) ||
        this.pending.some((job) => job.key === key && job.priority < priority)
      ) {
        reject(new Error("Background inference deferred while planning."));
        return;
      }
      this.cancel(
        (job) => job.key === key || (priority === 0 && job.priority > priority),
      );
      const job = {
        id,
        key,
        priority,
        input,
        controller: new AbortController(),
        resolve,
        reject,
      };
      this.pending.push(job);
      this.pending.sort((a, b) => a.priority - b.priority);
      while (this.pending.length > this.capacity) {
        const lowest = this.pending[this.pending.length - 1].priority;
        const [removed] = this.pending.splice(
          this.pending.findIndex((entry) => entry.priority === lowest),
          1,
        );
        removed.controller.abort();
        removed.reject(
          new Error("Inference queue is full; retry the current request."),
        );
      }
      void this.drain();
    });
  }
  cancel(
    matches: (job: {
      id: string;
      key: string;
      priority: number;
    }) => boolean = () => true,
  ) {
    if (this.active && matches(this.active)) {
      this.active.controller.abort();
      this.active.reject(new Error("Planning was replaced or canceled."));
    }
    this.pending = this.pending.filter((job) => {
      if (!matches(job)) return true;
      job.controller.abort();
      job.reject(new Error("Planning was replaced or canceled."));
      return false;
    });
  }
  private async drain() {
    if (this.active) return;
    while (this.pending.length) {
      const job = this.pending.shift()!;
      this.active = job;
      try {
        const value = await this.run(job.input, job.controller.signal);
        job.controller.signal.throwIfAborted();
        job.resolve(value);
      } catch (error) {
        job.reject(
          error instanceof Error ? error : new Error("Inference failed."),
        );
      } finally {
        this.active = undefined;
      }
    }
  }
}
