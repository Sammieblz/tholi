import { SqliteStorage } from "../storage";
import { createLocalWorkers } from "./local-workers";
import type { ApiOptions } from "../config";
import type { PrivateCapabilities } from "../capabilities";

export async function createPrivateCapabilities(
  options: ApiOptions,
): Promise<PrivateCapabilities> {
  const repository = new SqliteStorage(options.database);
  try {
    const workers = await createLocalWorkers(options);
    let closed = false;
    return {
      repository,
      workers,
      resources: [
        workers,
        {
          name: "sqlite",
          ready: () => !closed,
          stop: () => {},
          close: () => {
            if (closed) return;
            closed = true;
            repository.close();
          },
        },
      ],
    };
  } catch (error) {
    repository.close();
    throw error;
  }
}
