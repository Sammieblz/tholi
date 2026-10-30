import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runDatabaseCommand } from "../../../apps/api/src/database/cli";
import {
  parsePrivateConfig,
  parseDatabaseConfig,
  parseServiceConfig,
  validateApiOptions,
  validatePrivateConnection,
  validateServiceOptions,
  type ApiOptions,
} from "../../../apps/api/src/config";

const chrome = "chrome-extension://" + "a".repeat(32);
const firefox = "moz-extension://12345678-1234-1234-1234-123456789abc";
const privateOptions: ApiOptions = {
  token: "a".repeat(64),
  origins: [chrome, firefox],
  database: "data/navigator.sqlite",
  models: "assets/models",
};

describe("API configuration profiles", () => {
  it("refuses synthetic database seed outside the explicit development profile", async () => {
    for (const env of [
      { NODE_ENV: "production", THOLI_ALLOW_DEV_SEED: "true" },
      { NODE_ENV: "development", THOLI_ALLOW_DEV_SEED: "false" },
      {},
    ])
      await expect(runDatabaseCommand("seed", env)).rejects.toThrow(
        "development profile",
      );
    await expect(runDatabaseCommand("reset")).rejects.toThrow(
      "migrate, verify or seed",
    );
  });
  it("requires explicit PostgreSQL credentials and separates migration pool budgets", () => {
    const runtime = "postgresql://runtime:local@localhost/tholi";
    const migration = "postgresql://migrator:local@localhost/tholi";
    expect(parseDatabaseConfig({ THOLI_DATABASE_URL: runtime })).toEqual({
      connectionString: runtime,
      max: 8,
    });
    expect(
      parseDatabaseConfig(
        { THOLI_DATABASE_MIGRATION_URL: migration },
        "migration",
      ),
    ).toEqual({ connectionString: migration, max: 1 });
    expect(() =>
      parseDatabaseConfig({ THOLI_DATABASE_URL: runtime }, "migration"),
    ).toThrow("THOLI_DATABASE_MIGRATION_URL");
    expect(() =>
      parseDatabaseConfig({
        PGDATABASE: "implicit",
        NAVIGATOR_DATA_DIR: "private",
      }),
    ).toThrow("THOLI_DATABASE_URL");
    for (const value of ["0", "33", "1e1", "1.2", "NaN"])
      expect(() =>
        parseDatabaseConfig({
          THOLI_DATABASE_URL: runtime,
          THOLI_DATABASE_POOL_MAX: value,
        }),
      ).toThrow("budget");
    expect(() =>
      parseDatabaseConfig(
        {
          THOLI_DATABASE_MIGRATION_URL: migration,
          THOLI_DATABASE_POOL_MAX: "3",
        },
        "migration",
      ),
    ).toThrow("budget");
    for (const connection of [
      "navigator.sqlite",
      "https://example.test",
      "file:///private",
    ])
      expect(() =>
        parseDatabaseConfig({ THOLI_DATABASE_URL: connection }),
      ).toThrow();
  });
  it("retains loopback legacy defaults independently of service configuration", () => {
    const cwd = resolve("profile-fixture");
    expect(
      parsePrivateConfig(
        {
          PORT: "9000",
          THOLI_SERVICE_HOST: "0.0.0.0",
          THOLI_SERVICE_ORIGINS: "*",
        },
        cwd,
      ),
    ).toEqual({
      directory: resolve(cwd, ".navigator-api"),
      connectionPath: resolve(cwd, ".navigator-api/connection.json"),
      database: resolve(cwd, ".navigator-api/navigator.sqlite"),
      models: resolve(cwd, "assets/models"),
      origins: undefined,
      listen: { host: "127.0.0.1", port: 8787 },
    });
  });

  it("retains NAVIGATOR paths, port and explicit extension-origin overrides", () => {
    const config = parsePrivateConfig({
      NAVIGATOR_DATA_DIR: "private-data",
      NAVIGATOR_MODELS: "private-models",
      NAVIGATOR_PORT: "9876",
      NAVIGATOR_EXTENSION_ORIGINS: `${chrome}, ${firefox}`,
    });
    expect(config.directory).toBe(resolve("private-data"));
    expect(config.models).toBe(resolve("private-models"));
    expect(config.origins).toEqual([chrome, firefox]);
    expect(config.listen).toEqual({ host: "127.0.0.1", port: 9876 });
    expect(
      parsePrivateConfig({ NAVIGATOR_EXTENSION_ORIGINS: "" }).origins,
    ).toEqual([]);
  });

  it.each(["", "0", "65536", "1.5", "-1", "1e3", " 8787", "8x"])(
    "rejects invalid ports before startup: %j",
    (port) => {
      expect(() => parsePrivateConfig({ NAVIGATOR_PORT: port })).toThrow();
      expect(() => parseServiceConfig({ PORT: port })).toThrow();
    },
  );

  it("keeps service defaults separate from legacy credentials and origins", () => {
    expect(
      parseServiceConfig({
        NAVIGATOR_PORT: "9876",
        NAVIGATOR_DATA_DIR: "legacy",
        NAVIGATOR_EXTENSION_ORIGINS: chrome,
      }),
    ).toEqual({
      options: { origins: [] },
      listen: { host: "127.0.0.1", port: 8788 },
    });
  });

  it("accepts platform ports and explicit service listen/origin settings", () => {
    expect(parseServiceConfig({ PORT: "8080" }).listen.port).toBe(8080);
    expect(
      parseServiceConfig({
        PORT: "8080",
        THOLI_SERVICE_PORT: "8080",
        THOLI_SERVICE_HOST: "0.0.0.0",
        THOLI_SERVICE_ORIGINS: "https://tholi.io, http://localhost:5173",
      }),
    ).toEqual({
      options: { origins: ["https://tholi.io", "http://localhost:5173"] },
      listen: { host: "0.0.0.0", port: 8080 },
    });
    expect(parseServiceConfig({ THOLI_SERVICE_HOST: "::1" }).listen.host).toBe(
      "::1",
    );
    expect(() =>
      parseServiceConfig({ PORT: "8080", THOLI_SERVICE_PORT: "9000" }),
    ).toThrow(/agree/);
    expect(() =>
      parseServiceConfig({ THOLI_SERVICE_HOST: "http://0.0.0.0" }),
    ).toThrow(/host/);
  });

  it("defaults to the cloud-free model policy and fails closed for live or unknown providers", () => {
    expect(parseServiceConfig({ THOLI_MODEL_PROVIDER: "fake" })).toEqual(
      parseServiceConfig({}),
    );
    for (const provider of ["gemini", "unknown", ""])
      expect(() =>
        parseServiceConfig({
          THOLI_MODEL_PROVIDER: provider,
          THOLI_GEMINI_OPT_IN: "true",
          THOLI_GEMINI_SPEND_LIMIT_USD: "1",
        }),
      ).toThrow();
  });

  it.each([
    "*",
    "null",
    "https://*.example.com",
    "https://tholi.io/path",
    "https://tholi.io/",
    "https://user:secret@tholi.io",
    "https://tholi.io?secret=value",
    "https://tholi.io#fragment",
    chrome,
  ])("rejects non-exact service origins: %j", (origin) => {
    expect(() => validateServiceOptions({ origins: [origin] })).toThrow(
      /origins/,
    );
  });

  it("does not allow website or wildcard origins into the private profile", () => {
    expect(validateApiOptions(privateOptions).origins).toEqual([
      chrome,
      firefox,
    ]);
    for (const origin of [
      "https://tholi.io",
      "chrome-extension://*",
      "moz-extension://*",
    ])
      expect(() =>
        validateApiOptions({ ...privateOptions, origins: [origin] }),
      ).toThrow(/extensions/);
  });

  it.each([
    null,
    { ...privateOptions, token: null },
    { ...privateOptions, token: "short" },
    { ...privateOptions, token: " ".repeat(64) },
    { ...privateOptions, origins: "*" },
    { ...privateOptions, origins: [32] },
    { ...privateOptions, database: "" },
    { ...privateOptions, database: "data\0file" },
    { ...privateOptions, models: 32 },
    { ...privateOptions, worker: "file:///worker.js" },
    { ...privateOptions, worker: new URL("https://example.com/worker.js") },
  ])("rejects malformed programmatic private options", (options) => {
    expect(() => validateApiOptions(options as ApiOptions)).toThrow();
  });

  it("rejects malformed stored connections instead of inventing an identity", () => {
    for (const connection of [
      null,
      {},
      { token: "short", origins: [] },
      { token: "a".repeat(64), origins: ["*"] },
    ])
      expect(() => validatePrivateConnection(connection)).toThrow();
    expect(
      validatePrivateConnection({
        token: privateOptions.token,
        origins: [chrome],
      }),
    ).toEqual({
      token: privateOptions.token,
      origins: [chrome],
    });
  });
});
