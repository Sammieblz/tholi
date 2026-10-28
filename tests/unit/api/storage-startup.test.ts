import { expect, test, vi } from "vitest";
import { SqliteStorage } from "../../../apps/api/src/storage";

const database = vi.hoisted(() => ({
  open: vi.fn(),
  exec: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    constructor(path: string) {
      database.open(path);
    }
    exec(sql: string) {
      return database.exec(sql);
    }
    close() {
      return database.close();
    }
  },
}));

test("failed SQLite initialization closes the acquired handle and preserves its error", () => {
  const failure = new Error("Database initialization failed.");
  database.exec.mockImplementation(() => {
    throw failure;
  });
  let caught: unknown;
  try {
    new SqliteStorage("startup-failure.sqlite");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
  expect(database.open).toHaveBeenCalledExactlyOnceWith(
    "startup-failure.sqlite",
  );
  expect(database.close).toHaveBeenCalledTimes(1);
});
