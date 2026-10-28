import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import type { LocalWorkers } from "../capabilities";
import type { VisualObservation } from "../../../../packages/vision/contracts";

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort(): void;
};

/** The two local workers share one bounded request/response lifecycle. */
class WorkerRequests {
  private state: "starting" | "ready" | "stopped" | "failed" = "starting";
  private failure?: Error;
  private pending = new Map<string, Pending>();
  private started: Promise<void>;
  private startResolve!: () => void;
  private startReject!: (error: Error) => void;
  private startupTimer: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;

  constructor(
    private worker: Worker,
    private settings: {
      timeout: number;
      timeoutMessage: string;
      cancelled: string;
      stopped: string;
    },
  ) {
    this.started = new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    // A second worker can fail synchronously before composition awaits readiness.
    void this.started.catch(() => {});
    this.startupTimer = setTimeout(
      () => this.fail(new Error("Local worker startup timed out.")),
      10000,
    );
    worker.on("message", (message) => {
      if (message?.type === "ready" && this.state === "starting") {
        clearTimeout(this.startupTimer);
        this.state = "ready";
        this.startResolve();
        return;
      }
      if (!message || typeof message.id !== "string") return;
      const entry = this.take(message.id);
      if (!entry) return;
      if (typeof message.error === "string")
        entry.reject(new Error(message.error));
      else entry.resolve(message.value);
    });
    worker.on("error", (error) => this.fail(error));
    worker.on("messageerror", () =>
      this.fail(new Error("Invalid local worker response.")),
    );
    worker.on("exit", () => this.fail(new Error(settings.stopped)));
  }

  waitUntilReady() {
    return this.started;
  }

  ready() {
    return this.state === "ready";
  }

  private take(id: string) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.abort);
    return entry;
  }

  private cancel(id: string, error: Error) {
    const entry = this.take(id);
    if (!entry) return;
    try {
      this.worker.postMessage({ type: "cancel", id });
    } catch {
      // Cancellation still settles locally if the worker has already exited.
    }
    entry.reject(error);
  }

  private fail(error: Error) {
    if (this.state === "stopped" || this.state === "failed") return;
    this.state = "failed";
    this.failure = error;
    clearTimeout(this.startupTimer);
    this.startReject(error);
    for (const id of this.pending.keys()) this.take(id)!.reject(error);
  }

  request(
    message: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.ready())
      return Promise.reject(this.failure || new Error(this.settings.stopped));
    if (signal?.aborted)
      return Promise.reject(new Error(this.settings.cancelled));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id, new Error(this.settings.cancelled));
      const timer = setTimeout(
        () => this.cancel(id, new Error(this.settings.timeoutMessage)),
        this.settings.timeout,
      );
      this.pending.set(id, { resolve, reject, timer, signal, abort });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        this.worker.postMessage({ ...message, id });
      } catch (error) {
        this.take(id)?.reject(
          error instanceof Error
            ? error
            : new Error("Local worker request failed."),
        );
      }
    });
  }

  stop() {
    if (this.state === "stopped") return;
    this.state = "stopped";
    clearTimeout(this.startupTimer);
    this.startReject(new Error("API closed."));
    for (const id of this.pending.keys())
      this.cancel(id, new Error("API closed."));
  }

  close() {
    this.stop();
    return (this.closing ||= this.worker.terminate().then(() => {
      this.worker.removeAllListeners();
    }));
  }
}

export async function createLocalWorkers(options: {
  database: string;
  models: string;
  worker?: URL;
}): Promise<LocalWorkers> {
  const resources: WorkerRequests[] = [];
  try {
    const inference = new WorkerRequests(
      new Worker(options.worker || new URL("./inference.js", import.meta.url), {
        workerData: {
          database: options.database,
          models: resolve(options.models) + "/",
        },
      }),
      {
        timeout: 120000,
        timeoutMessage: "Indexing timed out. Retry with the same request.",
        cancelled: "Planning canceled.",
        stopped: "Inference worker stopped.",
      },
    );
    resources.push(inference);
    const recognition = new WorkerRequests(
      new Worker(new URL("./ocr.js", options.worker || import.meta.url), {
        workerData: { models: resolve(options.models, "../ocr") },
      }),
      {
        timeout: 30000,
        timeoutMessage: "OCR canceled",
        cancelled: "OCR canceled",
        stopped: "OCR worker stopped",
      },
    );
    resources.push(recognition);
    await Promise.all(resources.map((resource) => resource.waitUntilReady()));
    let closing: Promise<void> | undefined;
    return {
      name: "local-workers",
      ready: () => resources.every((resource) => resource.ready()),
      infer: (type, input, signal) =>
        inference.request({ type, input }, signal),
      recognize: async (input, signal) =>
        (await recognition.request({ input }, signal)) as VisualObservation,
      stop: () => resources.forEach((resource) => resource.stop()),
      close: () =>
        (closing ||= Promise.all(
          resources.map((resource) => resource.close()),
        ).then(() => {})),
    };
  } catch (error) {
    await Promise.allSettled(resources.map((resource) => resource.close()));
    throw error;
  }
}
