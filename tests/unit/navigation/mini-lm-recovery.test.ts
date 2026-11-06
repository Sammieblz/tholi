import { beforeEach, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  pipeline: vi.fn(),
  environment: { backends: { onnx: { wasm: {} as Record<string, unknown> } } },
}));
vi.mock("@huggingface/transformers", () => ({
  env: model.environment,
  pipeline: model.pipeline,
}));
import { MiniLM, DIMENSIONS } from "../../../packages/nlp/model";

function extractor() {
  const tensor = { data: new Float32Array(DIMENSIONS), dispose: vi.fn() };
  return Object.assign(
    vi.fn(async () => tensor),
    { dispose: vi.fn() },
  );
}
beforeEach(() => vi.resetAllMocks());

it("shares one failed initialization and lets the same local model recover on an explicit later request", async () => {
  const ready = extractor();
  model.pipeline
    .mockRejectedValueOnce(
      new TypeError("Failed to fetch PRIVATE_MODEL_PATH_SENTINEL"),
    )
    .mockResolvedValueOnce(ready);
  const local = new MiniLM("local-models/", "local-runtime/");
  const attempts = await Promise.allSettled([
    local.embed(["first"]),
    local.embed(["second"]),
  ]);
  expect(model.pipeline).toHaveBeenCalledOnce();
  for (const attempt of attempts) {
    expect(attempt.status).toBe("rejected");
    if (attempt.status !== "rejected") throw Error("Initialization must fail");
    expect(attempt.reason).toMatchObject({ code: "MODEL_ASSET_FAILED" });
    expect(attempt.reason.message).not.toContain("PRIVATE_MODEL_PATH_SENTINEL");
  }
  expect(await local.embed(["retry"])).toEqual([
    Array.from(new Float32Array(DIMENSIONS)),
  ]);
  expect(model.pipeline).toHaveBeenCalledTimes(2);
  expect(model.pipeline.mock.calls[1][2]).toMatchObject({
    dtype: "q8",
    device: "wasm",
    local_files_only: true,
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  expect(model.environment).toMatchObject({
    allowRemoteModels: false,
    allowLocalModels: true,
    useBrowserCache: false,
    useFSCache: false,
    backends: { onnx: { wasm: { numThreads: 1, proxy: false } } },
  });
  await local.dispose();
  expect(ready.dispose).toHaveBeenCalledOnce();
});

it("a disposed failed initialization cannot clear or dispose a newer model lifetime", async () => {
  let rejectOld!: (failure: Error) => void;
  const ready = extractor();
  model.pipeline
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValueOnce(ready);
  const local = new MiniLM("local-models/", "local-runtime/");
  const old = local.embed(["old"]).catch((failure) => failure);
  await vi.waitFor(() => expect(model.pipeline).toHaveBeenCalledOnce());
  const disposed = local.dispose();
  expect(await local.embed(["current"])).toHaveLength(1);
  rejectOld(new Error("PRIVATE_INITIALIZATION_SENTINEL"));
  expect(await old).toMatchObject({ code: "MODEL_INITIALIZATION_FAILED" });
  await disposed;
  expect(ready.dispose).not.toHaveBeenCalled();
  await local.embed(["still current"]);
  expect(model.pipeline).toHaveBeenCalledTimes(2);
  await local.dispose();
  expect(ready.dispose).toHaveBeenCalledOnce();
});

it("cancellation during initialization never runs inference and retains the initialized model for later work", async () => {
  let finish!: (value: ReturnType<typeof extractor>) => void;
  const ready = extractor();
  model.pipeline.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const local = new MiniLM("local-models/", "local-runtime/");
  const controller = new AbortController();
  const canceled = local
    .embed(["canceled"], controller.signal)
    .catch((failure) => failure);
  await vi.waitFor(() => expect(model.pipeline).toHaveBeenCalledOnce());
  controller.abort();
  finish(ready);
  expect(await canceled).toMatchObject({ name: "AbortError" });
  expect(ready).not.toHaveBeenCalled();
  await local.embed(["current"]);
  expect(model.pipeline).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  await local.dispose();
  expect(ready.dispose).toHaveBeenCalledOnce();
});
