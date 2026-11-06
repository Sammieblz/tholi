/** Closed local-engine failures may cross workers; exception text and paths may not. */
const failures = {
  HOST_UNAVAILABLE: {
    stage: "host",
    error:
      "Tholi could not connect to its local engine (HOST_UNAVAILABLE). Open Tholi from the toolbar and try again.",
  },
  WORKER_START_FAILED: {
    stage: "worker",
    error:
      "The local worker failed to start (WORKER_START_FAILED). Reload Tholi and try again.",
  },
  WORKER_REQUEST_FAILED: {
    stage: "worker",
    error:
      "The local request could not be sent (WORKER_REQUEST_FAILED). Try again.",
  },
  WORKER_RESPONSE_INVALID: {
    stage: "worker",
    error:
      "The local worker returned an invalid response (WORKER_RESPONSE_INVALID). Try again.",
  },
  MODEL_ASSET_FAILED: {
    stage: "assets",
    error:
      "Bundled model files could not be loaded (MODEL_ASSET_FAILED). Reload Tholi and try again.",
  },
  MODEL_WASM_FAILED: {
    stage: "wasm",
    error:
      "The local inference runtime failed to start (MODEL_WASM_FAILED). Reload Tholi and try again.",
  },
  MODEL_INITIALIZATION_FAILED: {
    stage: "model",
    error:
      "Local model initialization failed (MODEL_INITIALIZATION_FAILED). Try again.",
  },
  MODEL_OUTPUT_INVALID: {
    stage: "model",
    error:
      "The local model returned an invalid result (MODEL_OUTPUT_INVALID). Try again.",
  },
  STORAGE_UNAVAILABLE: {
    stage: "storage",
    error:
      "Local memory is unavailable (STORAGE_UNAVAILABLE). Close old Tholi pages and try again.",
  },
  PERCEPTION_INVALID: {
    stage: "perception",
    error:
      "The current page observation is unavailable (PERCEPTION_INVALID). Refresh the page and try again.",
  },
  INFERENCE_TIMEOUT: {
    stage: "timeout",
    error:
      "Local inference took too long (INFERENCE_TIMEOUT). Please try again.",
  },
  OCR_TIMEOUT: {
    stage: "timeout",
    error: "OCR took too long (OCR_TIMEOUT). Please try again.",
  },
  INFERENCE_FAILED: {
    stage: "inference",
    error: "Local inference failed (INFERENCE_FAILED). Please try again.",
  },
  OCR_FAILED: {
    stage: "ocr",
    error: "Local image processing failed (OCR_FAILED). Please try again.",
  },
  CANCELED: { stage: "inference", error: "Planning was replaced or canceled." },
  DEFERRED: {
    stage: "inference",
    error: "Background inference deferred while planning.",
  },
  QUEUE_FULL: {
    stage: "inference",
    error: "Inference queue is full; retry the current request.",
  },
  INDEXING_PENDING: {
    stage: "inference",
    error: "Indexing timed out. Retry with the same request.",
  },
  EMPTY_REQUEST: {
    stage: "perception",
    error: "Describe what you would like to do.",
  },
  REQUEST_TOO_COMPLEX: {
    stage: "perception",
    error: "Please split this request into at most three tasks.",
  },
  ENGINE_NOT_BUNDLED: {
    stage: "assets",
    error:
      "The selected experimental image engine is not included in this build. Choose the bundled engine.",
  },
} as const;

export type LocalEngineFailureCode = keyof typeof failures;
export type LocalEngineDiagnostic = {
  code: LocalEngineFailureCode;
  stage: (typeof failures)[LocalEngineFailureCode]["stage"];
};

export class LocalEngineError extends Error {
  constructor(readonly code: LocalEngineFailureCode) {
    super(failures[code].error);
    this.name = "LocalEngineError";
  }
}

export function localEngineFailure(
  failure: unknown,
  fallback: LocalEngineFailureCode,
): { error: string; diagnostic: LocalEngineDiagnostic } {
  let code = fallback;
  if (failure instanceof LocalEngineError) code = failure.code;
  else if (failure instanceof Error) {
    if (failure.name === "AbortError") code = "CANCELED";
    else if (failure.name === "ZodError") code = "PERCEPTION_INVALID";
    else if (
      ["InvalidStateError", "QuotaExceededError", "VersionError"].includes(
        failure.name,
      )
    )
      code = "STORAGE_UNAVAILABLE";
    else {
      const known = (Object.keys(failures) as LocalEngineFailureCode[]).find(
        (candidate) => failures[candidate].error === failure.message,
      );
      if (known) code = known;
    }
  }
  return {
    error: failures[code].error,
    diagnostic: { code, stage: failures[code].stage },
  };
}

/** Classify an observed model initialization failure without exporting its text. */
export function modelInitializationFailure(failure: unknown): LocalEngineError {
  if (failure instanceof LocalEngineError) return failure;
  if (failure instanceof Error && failure.name === "AbortError")
    return new LocalEngineError("CANCELED");
  if (
    failure instanceof Error &&
    (/wasm|webassembly/i.test(failure.message) ||
      ["CompileError", "LinkError"].includes(failure.name))
  )
    return new LocalEngineError("MODEL_WASM_FAILED");
  if (
    failure instanceof TypeError &&
    /fetch|download|load|network/i.test(failure.message)
  )
    return new LocalEngineError("MODEL_ASSET_FAILED");
  return new LocalEngineError("MODEL_INITIALIZATION_FAILED");
}

/** Worker envelopes are untrusted strings; accept only this closed contract. */
export function localEngineReplyFailure(
  reply: { error?: unknown; diagnostic?: unknown },
  fallback: LocalEngineFailureCode,
) {
  const value = reply.diagnostic;
  if (value && typeof value === "object" && "code" in value) {
    const code = value.code;
    if (typeof code === "string" && Object.hasOwn(failures, code)) {
      const failure = localEngineFailure(
        new LocalEngineError(code as LocalEngineFailureCode),
        fallback,
      );
      if (reply.error === failure.error) return failure;
    }
  }
  // Legacy known public messages remain compatible; arbitrary messages are discarded.
  return localEngineFailure(
    typeof reply.error === "string" ? new Error(reply.error) : undefined,
    fallback,
  );
}
