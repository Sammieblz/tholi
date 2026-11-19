/** Inspect only this smoke phase's messages, not earlier identity mail. */
export async function findCapturedMail({ origin, needle, expected }, readJson) {
  const fail = () => Error("The scoped local mail capture is invalid.");
  let base;
  try {
    base = new URL(origin);
  } catch {
    throw fail();
  }
  if (
    base.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.origin !== origin ||
    typeof needle !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(needle) ||
    ![1, 2].includes(expected)
  )
    throw fail();
  const url = new URL("/api/v1/search", base);
  url.search = new URLSearchParams({
    query: `"${needle}"`,
    start: "0",
    // One surplus result establishes a duplicate instead of hiding it in pagination.
    limit: String(expected + 1),
  }).toString();
  const result = await readJson(url.href);
  if (
    !Array.isArray(result?.messages) ||
    result.messages.length !== expected ||
    !result.messages.every(
      (message) =>
        message &&
        typeof message.ID === "string" &&
        /^[A-Za-z0-9-]{1,128}$/.test(message.ID) &&
        typeof message.Subject === "string",
    ) ||
    new Set(result.messages.map((message) => message.ID)).size !== expected
  )
    throw fail();
  return result.messages.map(({ ID, Subject }) => ({ ID, Subject }));
}
