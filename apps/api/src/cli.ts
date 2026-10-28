import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createApi } from "./server";
import {
  parsePrivateConfig,
  validateApiOptions,
  validatePrivateConnection,
  type ApiOptions,
  type Environment,
} from "./config";
import {
  isMainModule,
  runExecutable,
  startRuntime,
  type RuntimeApplication,
  type RuntimeOptions,
} from "./runtime";

async function readConnection(config: ReturnType<typeof parsePrivateConfig>) {
  try {
    return validatePrivateConnection(
      JSON.parse(await readFile(config.connectionPath, "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(config.directory, { recursive: true });
  const connection = { token: randomBytes(32).toString("hex"), origins: [] };
  try {
    await writeFile(
      config.connectionPath,
      JSON.stringify(connection, null, 2) + "\n",
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    return connection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return validatePrivateConnection(
      JSON.parse(await readFile(config.connectionPath, "utf8")),
    );
  }
}

export async function startPrivateApi(
  env: Environment = process.env,
  factory: (options: ApiOptions) => Promise<RuntimeApplication> = createApi,
  runtimeOptions: RuntimeOptions = {},
) {
  const config = parsePrivateConfig(env);
  const connection = await readConnection(config);
  const apiOptions = validateApiOptions({
    token: connection.token,
    origins: config.origins ?? connection.origins,
    database: config.database,
    models: config.models,
  });
  const runtime = await startRuntime(
    () => factory(apiOptions),
    config.listen,
    runtimeOptions,
  );
  return { ...runtime, config, origins: apiOptions.origins };
}

if (isMainModule(import.meta.url))
  await runExecutable(async () => {
    const { config, origins } = await startPrivateApi(process.env, createApi, {
      exit: (code) => process.exit(code),
    });
    console.log(
      `Tholi API: http://127.0.0.1:${config.listen.port}\nConnection settings: ${config.connectionPath}\nAllowed extensions: ${origins.join(", ") || "none; add your extension origin before connecting"}`,
    );
  });
