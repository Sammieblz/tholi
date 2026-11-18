import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  historyCursor,
  repositoryPage,
} from "../../../apps/api/src/database/history-pages";
import { RepositoryError } from "../../../apps/api/src/database/contracts";

const time = "2026-11-18T08:00:00.123456Z";
const row = () => ({ id: randomUUID(), createdAt: new Date(time) });

test("credit and usage cursors retain their historical wire formats and negotiated views", () => {
  const rows = [row(), row()],
    legacy = repositoryPage(rows, 1, time).nextCursor!,
    tagged = repositoryPage(rows, 1, time, 2).nextCursor!;
  expect(JSON.parse(Buffer.from(legacy, "base64url").toString())).toEqual([
    time,
    rows[0].id,
  ]);
  expect(historyCursor(legacy)).toEqual([time, rows[0].id]);
  expect(historyCursor(legacy, 1)).toEqual([time, rows[0].id]);
  const firstView = repositoryPage(rows, 1, time, 1).nextCursor!;
  expect(historyCursor(firstView, 1)).toEqual([time, rows[0].id]);
  expect(JSON.parse(Buffer.from(tagged, "base64url").toString())).toEqual([
    "usage",
    2,
    time,
    rows[0].id,
  ]);
  expect(historyCursor(tagged, 2)).toEqual([time, rows[0].id]);
  expect(() => historyCursor(legacy, 2)).toThrow(RepositoryError);
  expect(() => historyCursor(tagged, 1)).toThrow(RepositoryError);
  expect(repositoryPage(rows, rows.length)).not.toHaveProperty("nextCursor");
});

test("invoice cursors bind account, workspace and view while preserving microseconds", () => {
  const rows = [row(), row()],
    binding = {
      kind: "invoices" as const,
      accountId: randomUUID(),
      workspaceId: randomUUID(),
    },
    page = repositoryPage(rows, 1, time, binding),
    cursor = page.nextCursor!;
  expect(page.items).toEqual([rows[0]]);
  expect(historyCursor(cursor, binding)).toEqual([time, rows[0].id]);
  for (const view of [
    undefined,
    1,
    2,
    { ...binding, accountId: randomUUID() },
    { ...binding, workspaceId: randomUUID() },
  ] as const)
    expect(() => historyCursor(cursor, view)).toThrow(RepositoryError);
  for (const value of [
    "not-json",
    cursor + "=",
    "x".repeat(513),
    Buffer.from(JSON.stringify([time, rows[0].id])).toString("base64url"),
  ])
    expect(() => historyCursor(value, binding)).toThrow(RepositoryError);
  expect(historyCursor(undefined, binding)).toEqual([null, null]);
});
