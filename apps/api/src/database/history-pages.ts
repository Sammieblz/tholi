import { RepositoryError, type RepositoryPage } from "./contracts";

type HistoryView =
  1 | 2 | { kind: "invoices"; accountId: string; workspaceId: string };

function prefix(view?: HistoryView): (string | number)[] {
  return typeof view === "object"
    ? [view.kind, 1, view.accountId, view.workspaceId]
    : view === undefined
      ? []
      : ["usage", view];
}

/** Cursors select a position, never authority. Each caller still applies scope and RLS. */
export function historyCursor(
  value?: string,
  view?: HistoryView,
): [string | null, string | null] {
  if (!value) return [null, null];
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    let parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (view !== undefined) {
      const expected = prefix(view),
        candidate = parsed;
      if (
        Array.isArray(candidate) &&
        candidate.length === expected.length + 2 &&
        expected.every((part, index) => candidate[index] === part)
      )
        parsed = candidate.slice(expected.length);
      else if (view !== 1 || !Array.isArray(parsed) || parsed.length !== 2)
        throw Error();
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(parsed[0]) ||
      !Number.isFinite(Date.parse(parsed[0])) ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(parsed[1])
    )
      throw Error();
    return [parsed[0], parsed[1]];
  } catch {
    throw new RepositoryError(
      "INVALID_INPUT",
      "Use the opaque history cursor returned by the service.",
    );
  }
}

/** Keep PostgreSQL's full timestamp precision even though public Dates use milliseconds. */
export function repositoryPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  size: number,
  cursorTime?: string,
  view?: HistoryView,
): RepositoryPage<T> {
  const more = rows.length > size,
    items = rows.slice(0, size),
    last = items.at(-1);
  return {
    items,
    ...(more && last
      ? {
          nextCursor: Buffer.from(
            JSON.stringify([
              ...prefix(view),
              cursorTime ?? last.createdAt.toISOString(),
              last.id,
            ]),
          ).toString("base64url"),
        }
      : {}),
  };
}
