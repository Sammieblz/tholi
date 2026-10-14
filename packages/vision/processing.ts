import type { RecognitionInput, VisualObservation } from "./contracts";
export async function recognizeWithFallback(
  capture: Record<string, unknown>,
  services: {
    browser: (message: Record<string, unknown>) => Promise<any>;
    backend: (
      input: RecognitionInput,
      signal?: AbortSignal,
    ) => Promise<VisualObservation | undefined>;
  },
  backendEnabled: boolean,
  signal: AbortSignal,
): Promise<VisualObservation> {
  signal.throwIfAborted();
  let result: VisualObservation | undefined;
  if (backendEnabled) {
    const input = await services.browser({ ...capture, prepareOnly: true });
    signal.throwIfAborted();
    try {
      result = await services.backend(input, signal);
    } catch {
      signal.throwIfAborted();
    }
  }
  signal.throwIfAborted();
  result ??= await services.browser(capture);
  signal.throwIfAborted();
  return result!;
}
