import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { MODEL, DIMENSIONS } from "./constants";
import {
  LocalEngineError,
  modelInitializationFailure,
} from "./local-engine-error";
export { MODEL, MODEL_REVISION, DIMENSIONS } from "./constants";
export interface Embedder {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  dispose(): Promise<void>;
}
export class MiniLM implements Embedder {
  private extractor?: Promise<FeatureExtractionPipeline>;
  constructor(
    private root: string,
    private wasmRoot?: string,
  ) {}
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted();
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = this.root;
    env.useBrowserCache = false;
    env.useFSCache = false;
    if (env.backends.onnx.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
      if (this.wasmRoot) env.backends.onnx.wasm.wasmPaths = this.wasmRoot;
    }
    if (!this.extractor) {
      const pending: Promise<FeatureExtractionPipeline> = Promise.resolve()
        .then(
          () =>
            pipeline("feature-extraction", MODEL, {
              dtype: "q8",
              device: this.wasmRoot ? "wasm" : "cpu",
              local_files_only: true,
              session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
            }) as Promise<FeatureExtractionPipeline>,
        )
        .catch((failure: unknown) => {
          // A failed attempt must not poison the worker or clear a newer lifetime.
          if (this.extractor === pending) this.extractor = undefined;
          throw modelInitializationFailure(failure);
        });
      this.extractor = pending;
    }
    const extractor = await this.extractor;
    const result: number[][] = [];
    // Small batches let foreground queries/cancellation run between inference calls.
    for (const text of texts) {
      signal?.throwIfAborted();
      const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      let vector: number[];
      try {
        vector = Array.from(output.data as Float32Array);
      } finally {
        output.dispose();
      }
      if (
        vector.length !== DIMENSIONS ||
        vector.some((v) => !Number.isFinite(v))
      )
        throw new LocalEngineError("MODEL_OUTPUT_INVALID");
      result.push(vector);
      signal?.throwIfAborted();
    }
    return result;
  }
  async dispose() {
    const pending = this.extractor;
    this.extractor = undefined;
    // Initialization has already reported its failure to the request owner.
    const extractor = await pending?.catch(() => undefined);
    await extractor?.dispose();
  }
}
