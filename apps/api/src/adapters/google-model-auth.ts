import {
  ModelError,
  awaitModelOperation,
} from "../application/model-contracts";

/** ADC is loaded on an approved server invocation, never on import or in clients. */
export function createGoogleModelAccessToken(project: string) {
  const requests = new WeakMap<AbortSignal, Promise<string>>();
  return (signal: AbortSignal): Promise<string> => {
    const interrupted = () => new ModelError("CANCELLED");
    if (signal.aborted) return Promise.reject(interrupted());
    const retained = requests.get(signal);
    if (retained) return retained;
    const request = awaitModelOperation(
      async () => {
        try {
          const { GoogleAuth } = await import("google-auth-library");
          signal.throwIfAborted();
          const auth = new GoogleAuth({
            projectId: project,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            clientOptions: {
              forceRefreshOnFailure: false,
              transporterOptions: {
                signal,
                timeout: 5000,
                retry: false,
                maxRedirects: 0,
              },
            },
          });
          const token = await auth.getAccessToken();
          signal.throwIfAborted();
          if (!token) throw new ModelError("CONFIGURATION");
          return token;
        } catch {
          if (signal.aborted) throw interrupted();
          // SDK errors can contain credential paths, request bodies or headers.
          throw new ModelError("CONFIGURATION");
        }
      },
      signal,
      interrupted,
    );
    requests.set(signal, request);
    return request;
  };
}
