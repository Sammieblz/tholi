import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createApi } from "./server";
const directory = resolve(process.env.NAVIGATOR_DATA_DIR || ".navigator-api");
await mkdir(directory, { recursive: true });
const configPath = resolve(directory, "connection.json");
let config: { token: string; origins: string[] };
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch {
  config = { token: randomBytes(32).toString("hex"), origins: [] };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}
const origins =
  process.env.NAVIGATOR_EXTENSION_ORIGINS?.split(",").filter(Boolean) ||
  config.origins;
const app = await createApi({
  token: config.token,
  origins,
  database: resolve(directory, "navigator.sqlite"),
  models: process.env.NAVIGATOR_MODELS || "assets/models",
});
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.NAVIGATOR_PORT || 8787),
});
console.log(
  `Tholi API: http://127.0.0.1:${process.env.NAVIGATOR_PORT || 8787}\nConnection settings: ${configPath}\nAllowed extensions: ${origins.join(", ") || "none; add your extension origin before connecting"}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
