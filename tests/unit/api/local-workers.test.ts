import type { EventEmitter } from "node:events";
import type { WorkerOptions } from "node:worker_threads";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalWorkers } from "../../../apps/api/src/adapters/local-workers";
import type { LocalWorkers } from "../../../apps/api/src/capabilities";
import type { RecognitionInput } from "../../../packages/vision/contracts";

type WorkerStub = EventEmitter & {
  url: URL;
  options: WorkerOptions;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};
const state = vi.hoisted(() => ({
  workers: [] as WorkerStub[],
  constructions: 0,
  failConstruction: 0,
}));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      postMessage = vi.fn();
      terminate = vi.fn(async () => {
        this.emit("exit", 0);
        return 0;
      });
      constructor(
        public url: URL,
        public options: WorkerOptions,
      ) {
        super();
        if (++state.constructions === state.failConstruction)
          throw new Error("Cannot start worker");
        state.workers.push(this);
      }
    },
  };
});

const options = {
  database: "private.sqlite",
  models: "assets/models",
  worker: new URL("file:///prepared-api/inference.js"),
};
let runtime: LocalWorkers | undefined;
async function start() {
  const pending = createLocalWorkers(options);
  for (const worker of state.workers) worker.emit("message", { type: "ready" });
  return (runtime = await pending);
}
beforeEach(() => {
  vi.useFakeTimers();
  state.workers.length = 0;
  state.constructions = 0;
  state.failConstruction = 0;
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  vi.useRealTimers();
});

it("waits for both worker handshakes and preserves prepared worker locations", async () => {
  const pending = createLocalWorkers(options);
  let started = false;
  void pending.then(() => {
    started = true;
  });
  expect(state.workers.map((worker) => worker.url.href)).toEqual([
    "file:///prepared-api/inference.js",
    "file:///prepared-api/ocr.js",
  ]);
  expect(state.workers[0].options.workerData.database).toBe(options.database);
  state.workers[0].emit("message", { type: "ready" });
  await Promise.resolve();
  expect(started).toBe(false);
  state.workers[1].emit("message", { type: "ready" });
  runtime = await pending;
  expect(await runtime.ready()).toBe(true);
  const signal = new AbortController();
  const remove = vi.spyOn(signal.signal, "removeEventListener");
  const result = runtime.infer("plan", { requestId: "first" }, signal.signal);
  const message = state.workers[0].postMessage.mock.calls[0][0];
  expect(message).toMatchObject({
    type: "plan",
    input: { requestId: "first" },
  });
  state.workers[0].emit("message", {
    id: message.id,
    value: { status: "planned" },
  });
  await expect(result).resolves.toEqual({ status: "planned" });
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  signal.abort();
  expect(state.workers[0].postMessage).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("settles cancellation and the distinct inference/OCR deadlines without retaining listeners", async () => {
  await start();
  const signal = new AbortController();
  const remove = vi.spyOn(signal.signal, "removeEventListener");
  const cancelled = runtime!
    .infer("plan", {}, signal.signal)
    .catch((error) => error.message);
  const id = state.workers[0].postMessage.mock.calls[0][0].id;
  signal.abort();
  expect(await cancelled).toBe("Planning canceled.");
  expect(state.workers[0].postMessage).toHaveBeenLastCalledWith({
    type: "cancel",
    id,
  });
  expect(remove).toHaveBeenCalledOnce();
  const count = state.workers[0].postMessage.mock.calls.length;
  await expect(runtime!.infer("plan", {}, signal.signal)).rejects.toThrow(
    "Planning canceled.",
  );
  expect(state.workers[0].postMessage).toHaveBeenCalledTimes(count);
  const inference = runtime!.infer("plan", {}).catch((error) => error.message);
  const recognition = runtime!
    .recognize({} as RecognitionInput, new AbortController().signal)
    .catch((error) => error.message);
  await vi.advanceTimersByTimeAsync(30000);
  expect(await recognition).toBe("OCR canceled");
  await vi.advanceTimersByTimeAsync(90000);
  expect(await inference).toBe(
    "Indexing timed out. Retry with the same request.",
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects pending and future requests when a worker fails and closes both workers once", async () => {
  await start();
  const pending = runtime!.infer("plan", {}).catch((error) => error.message);
  state.workers[0].emit("error", new Error("Inference unavailable"));
  expect(await pending).toBe("Inference unavailable");
  expect(await runtime!.ready()).toBe(false);
  await expect(runtime!.infer("plan", {})).rejects.toThrow(
    "Inference unavailable",
  );
  const recognition = runtime!
    .recognize({} as RecognitionInput, new AbortController().signal)
    .catch((error) => error.message);
  runtime!.stop();
  expect(await recognition).toBe("API closed.");
  await runtime!.close();
  await runtime!.close();
  expect(
    state.workers.every((worker) => worker.terminate.mock.calls.length === 1),
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("settles serialization failures and worker exits immediately", async () => {
  await start();
  state.workers[0].postMessage.mockImplementationOnce(() => {
    throw new Error("Cannot clone input");
  });
  await expect(runtime!.infer("plan", {})).rejects.toThrow(
    "Cannot clone input",
  );
  expect(vi.getTimerCount()).toBe(0);
  const recognition = runtime!
    .recognize({} as RecognitionInput, new AbortController().signal)
    .catch((error) => error.message);
  state.workers[1].emit("exit", 1);
  expect(await recognition).toBe("OCR worker stopped");
  await expect(
    runtime!.recognize({} as RecognitionInput, new AbortController().signal),
  ).rejects.toThrow("OCR worker stopped");
});

it("cleans up an already-created worker when the second constructor fails", async () => {
  state.failConstruction = 2;
  await expect(createLocalWorkers(options)).rejects.toThrow(
    "Cannot start worker",
  );
  expect(state.workers).toHaveLength(1);
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds startup and closes both workers if readiness never arrives", async () => {
  const pending = createLocalWorkers(options).catch((error) => error.message);
  state.workers[0].emit("message", { type: "ready" });
  await vi.advanceTimersByTimeAsync(10000);
  expect(await pending).toBe("Local worker startup timed out.");
  expect(
    state.workers.every((worker) => worker.terminate.mock.calls.length === 1),
  ).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
