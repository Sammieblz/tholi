import { createServiceApi } from "./server";
import {
  parseServiceConfig,
  type Environment,
  type ServiceApiOptions,
} from "./config";
import {
  isMainModule,
  runExecutable,
  startRuntime,
  type RuntimeApplication,
  type RuntimeOptions,
} from "./runtime";

export async function startServiceApi(
  env: Environment = process.env,
  factory: (
    options: ServiceApiOptions,
  ) => Promise<RuntimeApplication> = createServiceApi,
  runtimeOptions: RuntimeOptions = {},
) {
  const config = parseServiceConfig(env);
  return startRuntime(
    () => factory(config.options),
    config.listen,
    runtimeOptions,
  );
}

if (isMainModule(import.meta.url))
  await runExecutable(async () => {
    await startServiceApi(process.env, createServiceApi, {
      exit: (code) => process.exit(code),
    });
    console.log(
      "Tholi service is listening; health and API discovery are available. Account and cloud navigation services are not enabled.",
    );
  });
